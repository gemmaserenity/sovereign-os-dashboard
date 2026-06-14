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
  const rows = await db.query('sovdash_tasks',
    'select=id,title,description,status,owner,due_date,created_at,completed_at&order=created_at.desc&limit=100'
  ).catch(() => []);

  const all = Array.isArray(rows) ? rows : [];
  return jsonResponse({
    ok: true,
    todo: all.filter(t => t.status === 'todo'),
    done: all.filter(t => t.status === 'done').slice(0, 30)
  });
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
