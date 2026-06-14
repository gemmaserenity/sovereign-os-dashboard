// GET /api/auth/status
// Returns { ok, userId } if session is valid, otherwise 401.

import { verifySession, jsonResponse, errorResponse, corsHeaders } from '../_lib/crypto.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet({ request, env }) {
  const session = await verifySession(request, env);
  if (!session) return errorResponse('Unauthorized', 401);
  return jsonResponse({ ok: true, userId: session.userId });
}
