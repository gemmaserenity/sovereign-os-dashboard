// /api/forecast — GET (list), POST (upsert month), DELETE (remove month)
// Manages the sovdash_revenue_forecast table (manually editable revenue projections).

import { verifySession, jsonResponse, errorResponse, corsHeaders } from './_lib/crypto.js';
import { supabase } from './_lib/supabase.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const db = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);
  const rows = await db.query('sovdash_revenue_forecast',
    'select=id,month,projected_amount,notes&order=month.desc&limit=12'
  ).catch(() => []);
  return jsonResponse({ ok: true, forecast: rows || [] });
}

export async function onRequestPost({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const { month, projected_amount, notes } = await request.json();
  if (!month) return errorResponse('month is required (YYYY-MM-DD)', 400);

  const db = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);
  const res = await fetch(`${env.SUPABASE_A_URL}/rest/v1/sovdash_revenue_forecast`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_A_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_A_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify({ month, projected_amount: projected_amount || 0, notes: notes || null })
  });
  if (!res.ok) return errorResponse(`DB error: ${res.status}`, 500);
  const [row] = await res.json();
  return jsonResponse({ ok: true, row });
}

export async function onRequestDelete({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return errorResponse('id query param required', 400);

  const db = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);
  await fetch(`${env.SUPABASE_A_URL}/rest/v1/sovdash_revenue_forecast?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      'apikey': env.SUPABASE_A_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_A_SERVICE_KEY}`
    }
  });
  return jsonResponse({ ok: true });
}
