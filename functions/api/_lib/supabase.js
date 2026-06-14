// Supabase REST helper — thin wrapper over PostgREST.
// No external dependencies; runs in Workers/Pages Functions runtime.

export function supabase(url, serviceKey) {
  const baseUrl = url.replace(/\/$/, '');
  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  async function req(path, options = {}) {
    const res = await fetch(`${baseUrl}/rest/v1${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase ${res.status}: ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  return {
    // GET with query params (object → ?key=value&...)
    get: (table, params = {}, headers = {}) => {
      const qs = new URLSearchParams(params).toString();
      return req(`/${table}${qs ? '?' + qs : ''}`, { method: 'GET', headers });
    },
    // GET with raw query string already built
    query: (table, qs = '') => req(`/${table}?${qs}`, { method: 'GET' }),
    // POST (insert)
    insert: (table, body) => req(`/${table}`, { method: 'POST', body: JSON.stringify(body) }),
    // PATCH (update matching rows)
    update: (table, body, qs) => req(`/${table}?${qs}`, { method: 'PATCH', body: JSON.stringify(body) }),
    // RPC
    rpc: (fn, body) => req(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) })
  };
}

// Count helper — returns integer from Content-Range or array length
export function countFrom(data) {
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'number') return data;
  return 0;
}
