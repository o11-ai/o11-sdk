import type { ReplaySession } from './replay-contract';
import type { TrackingOptions } from './transport';

/** Call only after the application's server authenticates the customer. */
export function replaySessionRequest(options: TrackingOptions) {
  const endpoint = new URL('./replay/session', options.endpoint);
  return async (input: { customerId: string; origin: string }): Promise<ReplaySession> => {
    if (!input.customerId || input.customerId.length > 128) throw new Error('An authenticated customer ID is required.');
    const origin = new URL(input.origin);
    if (origin.origin !== input.origin || origin.username || origin.password) throw new Error('Use an application origin without a path.');
    const response = await (options.fetch ?? fetch)(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit',
      headers: { Authorization: `Bearer ${options.key}`, 'Content-Type': 'application/json', 'X-O11-Environment': options.environment ?? 'production' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(Math.max(100, Math.min(10_000, options.timeoutMs ?? 3000))) });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Replay session could not be created.');
    let text = '';
    const decoder = new TextDecoder();
    try {
      while (true) { const part = await reader.read(); if (part.done) break; text += decoder.decode(part.value, { stream: true }); if (text.length > 4096) throw new Error('Invalid replay session response.'); }
    } finally { await reader.cancel().catch(() => undefined); }
    if (!response.ok) throw new Error(`Replay session was rejected (${response.status}).`);
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== 'object') throw new Error('Invalid replay session response.');
    const value = data as Record<string, unknown>;
    if (typeof value.recordingId !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.recordingId) || typeof value.token !== 'string' || !/^rpl_[a-f0-9]{64}$/.test(value.token)
      || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
      || (value.serverTime !== undefined && (typeof value.serverTime !== 'string' || !Number.isFinite(Date.parse(value.serverTime))))
      || Date.parse(value.expiresAt) <= (typeof value.serverTime === 'string' ? Date.parse(value.serverTime) : Date.now())
      || typeof value.enabled !== 'boolean' || typeof value.sampleRate !== 'number' || !Number.isFinite(value.sampleRate) || value.sampleRate < 0 || value.sampleRate > 1) throw new Error('Invalid replay session response.');
    return { recordingId: value.recordingId, token: value.token, expiresAt: value.expiresAt, enabled: value.enabled, sampleRate: value.sampleRate,
      ...(typeof value.serverTime === 'string' ? { serverTime: value.serverTime } : {}) };
  };
}
