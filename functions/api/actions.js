// POST /api/actions — Agent routing via Claude.
// Accepts text (+ optional media_url for voice/image/doc already uploaded to storage).
// Routes to: task creation, mailer trigger, or informs user it's a human-action item.
// Always requires confirmation before executing irreversible actions.
//
// PATCH /api/actions/:id/confirm — execute a confirmed action
// GET  /api/actions             — recent action log

import { verifySession, jsonResponse, errorResponse, corsHeaders } from './_lib/crypto.js';
import { supabase } from './_lib/supabase.js';

const SYSTEM_PROMPT = `You are the Sovereign OS Action Router for Gemma Serenity (AI business consultant) and Sascha Gorokhoff (leadership coach).

Your job: read the user's instruction and decide what to do with it.

Available tools:
- create_task: Add an item to the task list (title, owner: gemma|sascha|shared, due_date optional)
- enroll_email: Enroll an email address in a mailer sequence (email, sequence_id)
- reply_to_user: When the request is informational or you need clarification (message)
- human_action_required: When the task needs a human to act (outside available tools) — describe what's needed

Rules:
- For ANY irreversible action (enroll_email, external API calls), use the tool and set requires_confirmation=true.
- For task creation, set requires_confirmation=false (safe, easily undone).
- Be concise in your interpretation.
- If the instruction is ambiguous, use reply_to_user to ask.
- If the instruction is clearly Gemma's personal action item, use create_task with owner=gemma.
- If for Sascha, owner=sascha. If unclear, owner=shared.

Respond ONLY with a JSON object (no markdown), format:
{
  "tool": "create_task|enroll_email|reply_to_user|human_action_required",
  "requires_confirmation": true|false,
  "interpretation": "one sentence: what you understood the request to mean",
  "params": { ...tool-specific params },
  "proposed_description": "what will happen if confirmed (shown to user before they tap OK)"
}`;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// POST /api/actions — submit new instruction
export async function onRequestPost({ request, env }) {
  try {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const { input_type = 'text', raw_input, media_url } = await request.json();
  if (!raw_input?.trim()) return errorResponse('raw_input is required', 400);

  if (!env.ANTHROPIC_API_KEY) {
    return errorResponse('Anthropic API key not configured', 503);
  }

  const db = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);

  // Ask Claude to interpret the instruction
  let claudeResult;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: raw_input.trim() }]
      })
    });

    if (!claudeRes.ok) throw new Error(`Claude API ${claudeRes.status}`);
    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text || '{}';
    claudeResult = JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, ''));
  } catch (err) {
    claudeResult = {
      tool: 'reply_to_user',
      requires_confirmation: false,
      interpretation: 'Could not parse instruction',
      params: { message: 'Sorry, I could not process that. Please try again.' },
      proposed_description: 'No action taken'
    };
  }

  const status = claudeResult.requires_confirmation ? 'pending_confirmation' : 'pending';

  const [action] = await db.insert('sovdash_actions', {
    user_id:        session.userId,
    input_type,
    raw_input:      raw_input.trim(),
    media_url:      media_url || null,
    interpretation: claudeResult.interpretation,
    proposed_action: claudeResult,
    status
  });

  // If no confirmation needed and tool is safe, auto-execute
  if (!claudeResult.requires_confirmation) {
    const result = await executeAction(claudeResult, db, env);
    await db.update('sovdash_actions', {
      status: result.ok ? 'completed' : 'failed',
      action_taken:  claudeResult.tool,
      action_result: result,
      error_message: result.ok ? null : result.error
    }, `id=eq.${action.id}`);
    action.status = result.ok ? 'completed' : 'failed';
    action.action_result = result;
  }

  return jsonResponse({ ok: true, action });
  } catch (err) {
    return errorResponse('Action failed: ' + err.message, 500);
  }
}

// PATCH /api/actions — confirm a pending action
export async function onRequestPatch({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const { id, confirm } = await request.json();
  if (!id) return errorResponse('id is required', 400);

  const db = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);
  const [action] = await db.query('sovdash_actions', `id=eq.${id}&user_id=eq.${session.userId}`);
  if (!action) return errorResponse('Action not found', 404);
  if (action.status !== 'pending_confirmation') {
    return errorResponse('Action is not pending confirmation', 409);
  }

  if (!confirm) {
    await db.update('sovdash_actions', { status: 'dismissed' }, `id=eq.${id}`);
    return jsonResponse({ ok: true, status: 'dismissed' });
  }

  const result = await executeAction(action.proposed_action, db, env);
  await db.update('sovdash_actions', {
    status: result.ok ? 'completed' : 'failed',
    action_taken:  action.proposed_action?.tool,
    action_result: result,
    error_message: result.ok ? null : result.error
  }, `id=eq.${id}`);

  return jsonResponse({ ok: true, status: result.ok ? 'completed' : 'failed', result });
}

// GET /api/actions — last 30 actions
export async function onRequestGet({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const db = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);
  const rows = await db.query('sovdash_actions',
    `select=id,user_id,input_type,raw_input,interpretation,proposed_action,action_taken,action_result,status,created_at&order=created_at.desc&limit=30`
  ).catch(() => []);

  return jsonResponse({ ok: true, actions: rows || [] });
}

async function executeAction(plan, db, env) {
  try {
    switch (plan?.tool) {
      case 'create_task': {
        const [task] = await db.insert('sovdash_tasks', {
          title:       plan.params?.title || 'Untitled task',
          owner:       plan.params?.owner || 'shared',
          due_date:    plan.params?.due_date || null,
          description: plan.params?.description || null,
          status:      'todo'
        });
        return { ok: true, created: task };
      }

      case 'enroll_email': {
        if (!plan.params?.email || !plan.params?.sequence_id) {
          return { ok: false, error: 'Missing email or sequence_id' };
        }
        const mailerUrl = `${env.SUPABASE_A_URL}/rest/v1/mailer_enrollments`;
        const res = await fetch(mailerUrl, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_A_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_A_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            sequence_id:     plan.params.sequence_id,
            recipient_email: plan.params.email,
            status:          'active'
          })
        });
        return res.ok
          ? { ok: true, enrolled: plan.params.email }
          : { ok: false, error: `Mailer enroll failed: ${res.status}` };
      }

      case 'reply_to_user':
        return { ok: true, message: plan.params?.message };

      case 'human_action_required':
        return { ok: true, note: plan.params?.description || 'Logged for human follow-up' };

      default:
        return { ok: false, error: `Unknown tool: ${plan?.tool}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
