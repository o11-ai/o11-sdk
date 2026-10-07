export type ReplayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export function replayTransport(endpoint: string, send: ReplayFetch = fetch) {
  const base = new URL(endpoint);
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('Use an HTTPS replay endpoint.');
  if (!base.pathname.endsWith('/api/replay')) throw new Error('Use the endpoint ending in /api/replay.');
  return async (path: string, token: string, body: string, keepalive = false) => {
    let payload: BodyInit = body;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (!keepalive && body.length >= 8192 && typeof CompressionStream !== 'undefined') {
      const compressed = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      if (compressed.byteLength < new TextEncoder().encode(body).byteLength) { payload = compressed; headers['Content-Encoding'] = 'gzip'; }
    }
    // Keepalive has a small shared browser budget. Larger uploads use normal fetch.
    const response = await send(`${base.href}/${path}`, { method: 'POST', headers,
      body: payload, redirect: 'error', credentials: 'omit', keepalive: keepalive && new TextEncoder().encode(body).byteLength < 48_000,
      signal: AbortSignal.timeout(10_000) });
    await response.body?.cancel();
    if ([401, 403, 410].includes(response.status)) return { accepted: false, terminal: true, retryAfterMs: 0 };
    if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) return { accepted: false, terminal: true, retryAfterMs: 0 };
    const retry = Number(response.headers.get('Retry-After'));
    return { accepted: response.ok, terminal: false, retryAfterMs: Number.isFinite(retry) ? Math.min(3_600_000, Math.max(0, retry * 1000)) : 0 };
  };
}
