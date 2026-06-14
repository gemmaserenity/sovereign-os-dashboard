// /api/tasks — GET (list), POST (create), PATCH (update status/title)
// Gemma's tasks route to NEXT (future). For now all tasks go to sovdash_tasks.

import { verifySession, jsonResponse, errorResponse, corsHeaders } from './_lib/crypto.js';
import { supabase } from './_lib/supabase.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const db = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);

  const [nextRes, sovRes] = await Promise.allSettled([
    fetchNextTasks(env),
    db.query('sovdash_tasks',
      'select=id,title,description,status,owner,due_date,created_at,completed_at&order=created_at.desc&limit=100'
    ).catch(() => [])
  ]);

  const nextTasks = nextRes.status === 'fulfilled' ? nextRes.value : [];
  const sovRows   = Array.isArray(sovRes.value) ? sovRes.value : [];
  const sovTasks  = sovRows.map(t => ({
    id: t.id, title: t.title, done: t.status === 'done', owner: t.owner, source: 'sovdash'
  }));

  const all = [...nextTasks, ...sovTasks];
  return jsonResponse({
    ok: true,
    todo: all.filter(t => !t.done),
    done: all.filter(t =>  t.done).slice(0, 30)
  });
}

async function fetchNextTasks(env) {
  if (!env.NEXT_PASSCODE) return [];
  try {
    const res = await fetch('https://next-sync-api.gemma-serenity.workers.dev/api/data', {
      headers: { 'X-Passcode': env.NEXT_PASSCODE }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = Array.isArray(data.tasks) ? data.tasks : [];
    return raw.map(t => ({
      id:     t.id || String(Math.random()),
      title:  t.title || t.text || t.name || '(untitled)',
      done:   t.status === 'completed',
      owner:  'gemma',
      source: 'next'
    }));
  } catch { return []; }
}

export async function onRequestPost({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const { title, description, owner, due_date } = await request.json();
  if (!title?.trim()) return errorResponse('title is required', 400);

  const db = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);
  const [row] = await db.insert('sovdash_tasks', {
    title: title.trim(),
    description: description || null,
    owner: owner || 'shared',
    due_date: due_date || null,
    status: 'todo'
  });

  return jsonResponse({ ok: true, task: row });
}

export async function onRequestPatch({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const { id, status, title } = await request.json();
  if (!id) return errorResponse('id is required', 400);

  const updates = {};
  if (status && ['todo', 'done'].includes(status)) {
    updates.status = status;
    updates.completed_at = status === 'done' ? new Date().toISOString() : null;
  }
  if (title?.trim()) updates.title = title.trim();

  if (Object.keys(updates).length === 0) return errorResponse('Nothing to update', 400);

  const db = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);
  const [row] = await db.update('sovdash_tasks', updates, `id=eq.${id}`);
  return jsonResponse({ ok: true, task: row });
}
