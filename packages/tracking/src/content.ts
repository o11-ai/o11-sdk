import { retryAfterMs, type TrackingOptions, type TrackingReceipt } from './transport';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ContentReference = { id: string; sha256: string; bytes: number; valueType: 'string' | 'json' };
export type RecordReference = { kind: string; id: string; relation?: string };
const partBytes = 512 * 1024;
export async function uploadRecordContent(options: TrackingOptions, value: JsonValue): Promise<{ reference: ContentReference } | { failure: TrackingReceipt }> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > 64 * 1024 * 1024) return { failure: { accepted: false, retryable: false, code: 'content_too_large' } };
  const digest = await crypto.subtle.digest('SHA-256', bytes), sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const valueType = typeof value === 'string' ? 'string' as const : 'json' as const;
  const endpoint = new URL('./contents', options.endpoint), send = options.fetch ?? fetch;
  const headers = { Authorization: `Bearer ${options.key}`, 'X-O11-Environment': options.environment ?? 'production' };
  async function request(url: URL, body?: BodyInit, json = false): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < Math.max(1, Math.min(3, options.attempts ?? 3)); attempt++) {
      try {
        const response = await send(url, { method: 'POST', body, headers: { ...headers, 'Content-Type': json ? 'application/json' : 'application/octet-stream' },
          signal: AbortSignal.timeout(options.timeoutMs ?? 10000), redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return { failure: true, retryable: false, code: 'redirect_rejected' }; }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Missing response.');
        let text = '', size = 0;
        const decoder = new TextDecoder();
        try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
          if (size > 16384) return { failure: true, retryable: true, code: 'invalid_response' };
          text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
        finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        const data: unknown = JSON.parse(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid content response.');
        const parsed = data as Record<string, unknown>;
        if (response.ok && parsed.accepted === true) return parsed;
        if (response.status < 500 || attempt === 2) return { failure: true, retryable: response.status >= 500 || response.status === 429 || response.status === 408, code: parsed.code ?? 'content_upload_failed', status: response.status, retryAfterMs: retryAfterMs(response.headers.get('Retry-After')) };
      } catch { if (attempt === 2) break; }
    }
    return { failure: true, retryable: true, code: 'content_upload_unconfirmed' };
  }
  const started = await request(endpoint, JSON.stringify({ sha256, bytes: bytes.length, valueType, partCount: Math.ceil(bytes.length / partBytes) }), true);
  const failed = (data: Record<string, unknown>): { failure: TrackingReceipt } => ({ failure: { accepted: false, retryable: data.retryable !== false, code: typeof data.code === 'string' ? data.code : 'content_upload_failed', status: typeof data.status === 'number' ? data.status : undefined, retryAfterMs: typeof data.retryAfterMs === 'number' ? data.retryAfterMs : undefined } });
  if (started.failure || typeof started.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(started.id)) return failed(started);
  if (started.status !== 'ready') {
    const received = new Set(Array.isArray(started.received) ? started.received : []);
    for (let offset = 0, sequence = 0; offset < bytes.length; offset += partBytes, sequence++) {
      if (received.has(sequence)) continue;
      const result = await request(new URL(`./contents/${started.id}/parts/${sequence}`, options.endpoint), new Blob([bytes.subarray(offset, offset + partBytes)]));
      if (result.failure) return failed(result);
    }
    const completed = await request(new URL(`./contents/${started.id}/finish`, options.endpoint));
    if (completed.failure) return failed(completed);
  }
  return { reference: { id: started.id, sha256, bytes: bytes.length, valueType } };
}
