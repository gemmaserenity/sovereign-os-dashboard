// POST /api/auth/setup
// First-time password creation for a named user (gemma or sascha).
// Requires setup_code matching the SETUP_CODE Worker secret.

import { hashPassword, generateToken, jsonResponse, errorResponse, corsHeaders } from '../_lib/crypto.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
  try {
    const { username, password, setup_code } = await request.json();

    if (!['gemma', 'sascha'].includes(username)) {
      return errorResponse('username must be "gemma" or "sascha"', 400);
    }
    if (!password || password.length < 8) {
      return errorResponse('Password must be at least 8 characters', 400);
    }
    if (!env.SETUP_CODE) {
      return errorResponse('SETUP_CODE secret not found in environment', 500);
    }
    if (!setup_code || setup_code !== env.SETUP_CODE) {
      return errorResponse(`Invalid setup code (received ${setup_code?.length ?? 0} chars, expected ${env.SETUP_CODE.length} chars)`, 403);
    }

    const existing = await env.SOVDASH_KV.get(`auth:${username}`);
    if (existing) {
      return errorResponse(`${username} already has a password. Use /api/auth/login instead.`, 409);
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt);

    await env.SOVDASH_KV.put(`auth:${username}`, JSON.stringify({
      salt: Array.from(salt),
      hash: Array.from(new Uint8Array(hash)),
      createdAt: Date.now()
    }));

    const token = generateToken();
    await env.SOVDASH_KV.put(`session:${token}`, JSON.stringify({
      token, userId: username,
      createdAt: Date.now(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365
    }), { expirationTtl: 60 * 60 * 24 * 365 });

    return jsonResponse({ ok: true, token, userId: username });
  } catch (err) {
    return errorResponse('Setup failed: ' + err.message, 500);
  }
}
