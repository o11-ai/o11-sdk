export type TrackingEvent = {
  eventId: string; name: string; customerId: string; occurredAt: string;
  sessionId?: string; properties?: Record<string, string | number | boolean>;
};
export type TrackingReceipt = { accepted: boolean; retryable: boolean; status?: number };
export type TrackingFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type TrackingOptions = { endpoint: string; key: string; fetch?: TrackingFetch; timeoutMs?: number; attempts?: number };
export function validEvent(event: TrackingEvent): boolean {
  const id = (value: string | undefined) => !!value && value.length <= 128;
  return id(event.eventId) && id(event.customerId) && (!event.sessionId || id(event.sessionId))
    && /^[a-z][a-z0-9_.]{1,99}$/.test(event.name) && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(event.occurredAt) && Number.isFinite(Date.parse(event.occurredAt))
    && Object.entries(event.properties ?? {}).length <= 20
    && Object.entries(event.properties ?? {}).every(([name, value]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)
      && (typeof value === 'string' ? value.length <= 2000 : typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))));
}
/** Server only. Reuse eventId on retries; use the application's outbox for durable delivery. */
export function createTrackingClient(options: TrackingOptions) {
  if (typeof window !== 'undefined') throw new Error('o11 tracking keys must stay on the server.');
  const endpoint = new URL(options.endpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)))) throw new Error('Use an HTTPS tracking endpoint (HTTP is allowed only on loopback).');
  if (!options.key.trim()) throw new Error('A source tracking key is required.');
  if ((options.attempts !== undefined && !Number.isFinite(options.attempts)) || (options.timeoutMs !== undefined && !Number.isFinite(options.timeoutMs))) throw new Error('Retry and timeout settings must be finite numbers.');
  const attempts = Math.max(1, Math.min(3, Math.floor(options.attempts ?? 3)));
  const timeoutMs = Math.max(100, Math.min(10000, options.timeoutMs ?? 3000));
  const send = options.fetch ?? fetch;
  return {
    async track(event: TrackingEvent): Promise<TrackingReceipt> {
      if (!validEvent(event)) return { accepted: false, retryable: false };
      const body = JSON.stringify(event);
      if (new TextEncoder().encode(body).byteLength > 32000) return { accepted: false, retryable: false };
      let status: number | undefined;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const response = await send(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.key}` }, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
          status = response.status;
          await response.body?.cancel();
          if (response.ok) return { accepted: true, retryable: false, status };
          if (status < 500 && status !== 429 && status !== 408) return { accepted: false, retryable: false, status };
        } catch { /* The caller can retry the same event from its durable outbox. */ }
        if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      }
      return { accepted: false, retryable: true, status };
    },
  };
}
