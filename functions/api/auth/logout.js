// POST /api/auth/logout
// Deletes the current session token from KV.

import { jsonResponse, errorResponse, corsHeaders } from '../_lib/crypto.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = request.headers.get('Authorization') || '';
    const match = auth.match(/^Bearer\s+([a-f0-9]{64})$/i);
    if (match) {
      await env.SOVDASH_KV.delete(`session:${match[1]}`);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse('Logout failed: ' + err.message, 500);
  }
}
