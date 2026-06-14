// Shared crypto and HTTP utilities — Cloudflare Workers runtime (V8 isolate).

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

export function errorResponse(message, status = 500) {
  return jsonResponse({ ok: false, error: message }, status);
}

// PBKDF2 — 100k iterations SHA-256
export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
}

export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Reads Authorization: Bearer <token>, validates against KV.
// Returns session object (including userId) or null.
export async function verifySession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (!match) return null;

  const raw = await env.SOVDASH_KV.get(`session:${match[1]}`);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    if (session.expiresAt && session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}
