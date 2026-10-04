export type TrackingReceipt = { accepted: boolean; retryable: boolean; status?: number; receiptId?: string; code?: string; retryAfterMs?: number };
export type TrackingFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type TrackingOptions = { endpoint: string; key: string; environment?: 'test' | 'production'; fetch?: TrackingFetch; timeoutMs?: number; attempts?: number };
export type ReceiptStatus = { id: string; kind: string; status: 'queued' | 'processed' | 'rejected'; code: string | null; processedAt: string | null };

export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, Math.min(3600000, delay)) : undefined;
}
async function boundedJson(response: Response): Promise<Record<string, unknown> | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4096) return undefined; chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; } finally { await reader.cancel().catch(() => {}); }
}
export function trackingTransport(options: TrackingOptions) {
  if (typeof window !== 'undefined' || (typeof location !== 'undefined' && typeof navigator !== 'undefined')) throw new Error('o11 tracking keys must stay on the server.');
  const endpoint = new URL(options.endpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)))) throw new Error('Use an HTTPS tracking endpoint (HTTP is allowed only on loopback).');
  if (!endpoint.pathname.endsWith('/events')) throw new Error('Use the tracking events endpoint ending in /events.');
  if (!options.key.trim()) throw new Error('A source tracking key is required.');
  if ((options.attempts !== undefined && !Number.isFinite(options.attempts)) || (options.timeoutMs !== undefined && !Number.isFinite(options.timeoutMs))) throw new Error('Retry and timeout settings must be finite numbers.');
  const environment = options.environment ?? 'production';
  // Read the consumer's environment dynamically; bundlers replace direct process.env.NODE_ENV access.
  const { NODE_ENV: runtimeEnvironment } = typeof process === 'undefined' ? {} : process.env;
  if (['development', 'test'].includes(runtimeEnvironment ?? '') && environment === 'production') throw new Error('Use a development tracking key and environment: test outside production.');
  const attempts = Math.max(1, Math.min(3, Math.floor(options.attempts ?? 3)));
  const timeoutMs = Math.max(100, Math.min(10000, options.timeoutMs ?? 3000)), send = options.fetch ?? fetch;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${options.key}`, 'X-O11-Environment': environment };
  const url = (kind: string) => kind === 'events' ? endpoint : new URL(`./${kind}`, endpoint);
  return {
    async post(kind: string, value: unknown): Promise<TrackingReceipt> {
      const body = JSON.stringify(value);
      if (new TextEncoder().encode(body).byteLength > 32000) return { accepted: false, retryable: false, code: 'payload_too_large' };
      let status: number | undefined, delay: number | undefined;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const response = await send(url(kind), { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
          status = response.status; delay = retryAfterMs(response.headers.get('Retry-After'));
          const data = await boundedJson(response);
          if (response.ok) return data?.accepted === true && typeof data.receiptId === 'string' ? { accepted: true, retryable: false, status, receiptId: data.receiptId } : { accepted: false, retryable: true, status, code: 'invalid_response' };
          const code = typeof data?.code === 'string' ? data.code : 'request_rejected';
          if (status < 500 && status !== 429 && status !== 408) return { accepted: false, retryable: false, status, code };
          // Long provider holds belong in the caller's durable outbox, not a sleeping request.
          if (delay && delay > 2000) return { accepted: false, retryable: true, status, code, retryAfterMs: delay };
        } catch { /* Retry the identical occurrence, never generate a replacement ID. */ }
        if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, Math.max(delay ?? 0, 250 * 2 ** attempt + Math.floor(Math.random() * 100))));
      }
      return { accepted: false, retryable: true, status, code: 'delivery_unconfirmed', ...(delay !== undefined ? { retryAfterMs: delay } : {}) };
    },
    async receipt(id: string): Promise<ReceiptStatus | null> {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Use the receipt ID returned by o11.');
      const response = await send(url(`receipts/${id}`), { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      const data = await boundedJson(response);
      if (!response.ok || !data || data.id !== id || !['queued', 'processed', 'rejected'].includes(String(data.status))) return null;
      return { id, kind: String(data.kind), status: data.status as ReceiptStatus['status'], code: typeof data.code === 'string' ? data.code : null, processedAt: typeof data.processedAt === 'string' ? data.processedAt : null };
    },
  };
}
