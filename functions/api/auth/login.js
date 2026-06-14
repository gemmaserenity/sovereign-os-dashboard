// POST /api/auth/login
// Accepts { username, password }, returns session token.

import { hashPassword, generateToken, jsonResponse, errorResponse, corsHeaders, constantTimeEqual } from '../_lib/crypto.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
  try {
    const { username, password } = await request.json();

    if (!['gemma', 'sascha'].includes(username)) {
      return errorResponse('Invalid credentials', 401);
    }
    if (!password) {
      return errorResponse('Password required', 400);
    }

    const raw = await env.SOVDASH_KV.get(`auth:${username}`);
    if (!raw) {
      await new Promise(r => setTimeout(r, 200));
      return errorResponse('Invalid credentials', 401);
    }

    const auth = JSON.parse(raw);
    const salt = new Uint8Array(auth.salt);
    const expected = new Uint8Array(auth.hash);
    const actual = new Uint8Array(await hashPassword(password, salt));

    if (!constantTimeEqual(expected, actual)) {
      await new Promise(r => setTimeout(r, 200));
      return errorResponse('Invalid credentials', 401);
    }

    const token = generateToken();
    await env.SOVDASH_KV.put(`session:${token}`, JSON.stringify({
      token, userId: username,
      createdAt: Date.now(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365
    }), { expirationTtl: 60 * 60 * 24 * 365 });

    return jsonResponse({ ok: true, token, userId: username });
  } catch (err) {
    return errorResponse('Login failed: ' + err.message, 500);
  }
}
