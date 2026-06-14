// GET /api/dashboard
// Aggregates all panel data in parallel. Each source fails gracefully
// (returns null/empty) so one broken integration never kills the dashboard.

import { verifySession, jsonResponse, errorResponse, corsHeaders } from './_lib/crypto.js';
import { supabase } from './_lib/supabase.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  const dbA = supabase(env.SUPABASE_A_URL, env.SUPABASE_A_SERVICE_KEY);
  const dbB = supabase(env.SUPABASE_B_URL, env.SUPABASE_B_SERVICE_KEY);

  const [crm, social, email, revenue, calendar, tasks] = await Promise.allSettled([
    fetchCRM(dbB),
    fetchSocial(dbA),
    fetchEmail(dbA),
    fetchRevenue(dbA, env),
    fetchCalendar(env),
    fetchTasks(dbA)
  ]);

  return jsonResponse({
    ok: true,
    ts: Date.now(),
    crm:      settled(crm),
    social:   settled(social),
    email:    settled(email),
    revenue:  settled(revenue),
    calendar: settled(calendar),
    tasks:    settled(tasks)
  });
}

function settled(result) {
  if (result.status === 'fulfilled') return result.value;
  console.error('[dashboard] panel error:', result.reason?.message || result.reason);
  return { error: result.reason?.message || 'unavailable' };
}

// ─── CRM (Project B) ─────────────────────────────────────────────────────────
async function fetchCRM(db) {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [allContacts, newContacts] = await Promise.all([
    db.get('contacts', { select: 'id', limit: 1 }, { 'Prefer': 'count=exact' })
      .catch(() => []),
    db.query('contacts', `select=id&created_at=gte.${cutoff}`)
      .catch(() => [])
  ]);

  // PostgREST returns count in Content-Range header; we fall back to array length
  return {
    total: Array.isArray(allContacts) ? allContacts.length : 0,
    new_14d: Array.isArray(newContacts) ? newContacts.length : 0
  };
}

// ─── Social Media Forge (Project A — ce_* tables) ────────────────────────────
async function fetchSocial(db) {
  const brands = ['ce_gemma_ai_posts', 'ce_gemma_prs_posts', 'ce_sascha_posts', 'ce_tmq_posts'];
  const brandLabels = {
    ce_gemma_ai_posts:  'Gemma AI',
    ce_gemma_prs_posts: 'Gemma PRS',
    ce_sascha_posts:    'Sascha Leadership',
    ce_tmq_posts:       'The Manifesting Queen'
  };

  const results = await Promise.all(
    brands.map(t => db.get(t, { select: 'status' }).catch(() => []))
  );

  const totals = { draft: 0, approved: 0, published: 0, archived: 0 };
  const byBrand = {};

  brands.forEach((table, i) => {
    const rows = Array.isArray(results[i]) ? results[i] : [];
    const counts = { draft: 0, approved: 0, published: 0, archived: 0 };
    rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
    byBrand[brandLabels[table]] = counts;
    Object.keys(totals).forEach(s => { totals[s] += counts[s]; });
  });

  return { totals, byBrand };
}

// ─── Email Sequences (Project A — mailer_sequence_summary view) ──────────────
async function fetchEmail(db) {
  const rows = await db.get('mailer_sequence_summary', { select: '*' }).catch(() => []);
  if (!Array.isArray(rows)) return { sequences: [] };

  return {
    sequences: rows.map(r => ({
      id:           r.sequence_id,
      name:         r.sequence_name,
      status:       r.sequence_status,
      total:        Number(r.total_enrollments) || 0,
      active:       Number(r.active_enrollments) || 0,
      completed:    Number(r.completed_enrollments) || 0,
      exited:       Number(r.exited_enrollments) || 0,
      bounced:      Number(r.bounced_enrollments) || 0,
      unsubscribed: Number(r.unsubscribed_enrollments) || 0,
      sent:         Number(r.total_sent) || 0,
      opened:       Number(r.total_opened) || 0,
      clicked:      Number(r.total_clicked) || 0
    }))
  };
}

// ─── Revenue (Project A forecast + Stripe) ───────────────────────────────────
async function fetchRevenue(db, env) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [forecast, pending, realized] = await Promise.allSettled([
    db.query('sovdash_revenue_forecast', 'select=month,projected_amount,notes&order=month.desc&limit=6')
      .catch(() => []),
    fetchStripePending(env),
    fetchStripeRealized(env, startOfMonth)
  ]);

  return {
    forecast:  forecast.status  === 'fulfilled' ? (forecast.value  || []) : [],
    pending:   pending.status   === 'fulfilled' ? pending.value   : 0,
    realized:  realized.status  === 'fulfilled' ? realized.value  : 0
  };
}

async function fetchStripePending(env) {
  if (!env.STRIPE_SECRET_KEY) return 0;
  const res = await fetch('https://api.stripe.com/v1/invoices?status=open&limit=100', {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  if (!res.ok) return 0;
  const data = await res.json();
  return (data.data || []).reduce((sum, inv) => sum + (inv.amount_due || 0), 0) / 100;
}

async function fetchStripeRealized(env, startOfMonth) {
  if (!env.STRIPE_SECRET_KEY) return 0;
  const since = Math.floor(startOfMonth.getTime() / 1000);
  const res = await fetch(
    `https://api.stripe.com/v1/charges?status=succeeded&created[gte]=${since}&limit=100`,
    { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` } }
  );
  if (!res.ok) return 0;
  const data = await res.json();
  return (data.data || []).reduce((sum, c) => sum + (c.amount || 0), 0) / 100;
}

// ─── Google Calendar ─────────────────────────────────────────────────────────
async function fetchCalendar(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    return { events: [], note: 'Google Calendar not configured' };
  }

  // Refresh access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token'
    })
  });

  if (!tokenRes.ok) return { events: [], error: 'Token refresh failed' };
  const { access_token } = await tokenRes.json();

  // Fetch events: now → +48h
  const now = new Date().toISOString();
  const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${now}&timeMax=${in48h}&maxResults=10&orderBy=startTime&singleEvents=true`,
    { headers: { 'Authorization': `Bearer ${access_token}` } }
  );

  if (!calRes.ok) return { events: [], error: 'Calendar fetch failed' };
  const data = await calRes.json();

  return {
    events: (data.items || []).map(e => ({
      id:       e.id,
      title:    e.summary || '(no title)',
      start:    e.start?.dateTime || e.start?.date,
      end:      e.end?.dateTime || e.end?.date,
      allDay:   !e.start?.dateTime,
      location: e.location || null,
      url:      e.htmlLink || null
    }))
  };
}

// ─── Tasks (sovdash_tasks — Sascha/shared; NEXT integration future) ───────────
async function fetchTasks(db) {
  const rows = await db.query('sovdash_tasks',
    'select=id,title,description,status,owner,due_date,created_at,completed_at&order=created_at.desc&limit=100'
  ).catch(() => []);

  const all = Array.isArray(rows) ? rows : [];
  return {
    todo: all.filter(t => t.status === 'todo'),
    done: all.filter(t => t.status === 'done').slice(0, 20)
  };
}
