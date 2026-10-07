import { AuthenticationTransportError } from './coordinated-auth';
import type { AuthProvider } from '@modelcontextprotocol/client';
import { redact, sensitiveValues } from './redact';

export class ApiError extends Error {
  readonly details: Record<string, unknown>;
  constructor(readonly status: number, details: Record<string, unknown>) {
    super(typeof details.message === 'string' ? details.message : `API request failed (${status}).`);
    this.details = { ...details, httpStatus: status || null };
  }
}
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; mutation?: boolean; }
// Report longer provider windows without sleeping past the existing retry cap.
const MAX_RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export function retryTiming(header: string | null, now = Date.now()): { retryAfterMs: number; retryAt: string } | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  const delay = /^\d+$/.test(value) ? Number(value) * 1000
    : /^[A-Za-z]{3,9},?\s/.test(value) ? Date.parse(value) - now : NaN;
  if (!Number.isFinite(delay) || delay > MAX_RETRY_AFTER_MS || !Number.isFinite(now)) return undefined;
  const retryAfterMs = Math.max(0, Math.ceil(delay));
  return { retryAfterMs, retryAt: new Date(now + retryAfterMs).toISOString() };
}
/** Add jitter above the provider minimum; never retry a provider window beyond our cap. */
export function retryDelay(header: string | null, attempt: number, random: () => number = Math.random, now = Date.now()): number | undefined {
  const minimum = header === null ? 250 * 2 ** attempt : retryTiming(header, now)?.retryAfterMs;
  if (minimum === undefined) return undefined;
  if (!Number.isFinite(minimum) || minimum > 5000) return undefined;
  const base = Math.max(0, minimum), sample = random();
  const jitter = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
  return base + Math.floor(jitter * Math.min(250 * 2 ** attempt, 5000 - base));
}
const readPaths = /^(status|docs(?:\/[^?]*)?|commands(?:\/[^?]*)?|operations\/[^?]+)(?:\?|$)/;
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
});
async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('INVALID_RESPONSE');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { reader.releaseLock(); }
}
/** Writes are never retried except after an explicit authentication rejection. */
export class ApiClient {
  constructor(private server: URL, private provider?: AuthProvider, private token?: string, private send: typeof fetch = fetch, private random: () => number = Math.random) {}
  async request(path: string, input?: Record<string, unknown>, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const url = new URL(`/api/agent/v1/${path}`, this.server);
    if (url.origin !== this.server.origin || !url.pathname.startsWith('/api/agent/v1/')) throw new Error('Invalid API path.');
    const requestId = crypto.randomUUID();
    // The agent API rejects every mutation without _operationId before execution.
    // Ordinary query POSTs can therefore use the same bounded read retry policy.
    const safeRead = options.mutation !== true && (readPaths.test(path) || ((path.startsWith('execute/') || path === 'artifacts/read') && !Object.hasOwn(input ?? {}, '_operationId')));
    const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 60_000), ...(options.signal ? [options.signal] : [])]);
    const context = { requestId, ...(typeof input?._operationId === 'string' ? { operationId: input._operationId } : {}) };
    const recovery = safeRead ? path.startsWith('execute/') && options.mutation === undefined
      ? 'Inspect the command schema. Mutations require a stable UUID _operationId; inspect any existing operation receipt before repeating a write.'
      : 'Retry this read.' : 'A remote write may continue; inspect its operation receipt before repeating it.';
    const secrets = [...sensitiveValues(input), ...(this.token ? [this.token] : [])];
    const authorize = async <T>(action: () => Promise<T>): Promise<T> => {
      try { return await action(); }
      catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof AuthenticationTransportError) throw new ApiError(error.status, { ...context, code: 'AUTHENTICATION_UNAVAILABLE', applied: false,
          message: error.message, recovery: 'Retry this command with the same profile, input and existing _operationId. Your saved login is retained.' });
        throw new ApiError(401, { ...context, code: 'AUTHENTICATION_REQUIRED', applied: false,
          message: 'Authentication failed before the command was accepted. Reconnect the correct profile and grant the required consent.',
          recovery: 'Repair the profile login, then retry with the same input and existing _operationId.' });
      }
    };
    const send = async () => {
      const token = this.token ?? await authorize(async () => this.provider?.token());
      if (token && !secrets.includes(token)) secrets.push(token);
      return this.send(url, { method: input === undefined ? 'GET' : 'POST', redirect: 'error', signal,
        headers: { Accept: 'application/json', 'X-Request-Id': requestId, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    };
    let response: Response;
    try {
      response = await send();
      if (response.status === 401 && !this.token && this.provider?.onUnauthorized) {
        try { await authorize(async () => this.provider!.onUnauthorized!({ serverUrl: this.server, response, fetchFn: (url, init) => this.send(url, { ...init, redirect: 'error', signal }) })); }
        finally { await response.body?.cancel(); }
        response = await send();
      }
      for (let attempt = 0; safeRead && [429, 502, 503, 504].includes(response.status) && attempt < 2; attempt++) {
        const delay = retryDelay(response.headers.get('retry-after'), attempt, this.random);
        if (delay === undefined) break;
        await response.body?.cancel(); await sleep(delay, signal); response = await send();
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, { ...context, code: signal.aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR', message: `${signal.aborted ? 'Request cancelled or timed out.' : 'Network request failed.'} ${recovery}` });
    }
    const traceId = response.headers.get('x-request-id') ?? response.headers.get('cf-ray') ?? requestId;
    const timing = retryTiming(response.headers.get('retry-after'));
    if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new ApiError(response.status, { ...context, traceId, ...timing, code: 'INVALID_RESPONSE', message: 'The API did not return JSON. Check the server URL.', recovery }); }
    let result: unknown;
    try { result = await boundedJson(response, options.maxBytes ?? 8 * 1024 * 1024); }
    catch (error) { throw new ApiError(response.status, { ...context, traceId, ...timing, code: error instanceof Error && error.message === 'RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : 'INVALID_RESPONSE', message: 'The API response could not be read. Request a smaller result page.', recovery }); }
    if (!object(result)) throw new ApiError(response.status, { ...context, traceId, code: 'INVALID_RESPONSE', message: 'Invalid API response.' });
    if (!response.ok || result.error) {
      const detail = object(result.error) ? result.error : {};
      const limited = response.status === 429;
      const statusGuidance = response.status === 401 ? 'Reconnect the correct profile and check its credentials.'
        : response.status === 403 ? 'Inspect the required scopes and workspace grant for this profile.'
        : response.status === 404 ? 'Check the resource ID, command path and server URL.'
        : [400, 422].includes(response.status) ? 'Inspect the command schema and correct the request input.' : undefined;
      const statusRecovery = statusGuidance
        ? `${statusGuidance}${readPaths.test(path) || path === 'artifacts/read' ? '' : ` ${recovery}`}`
        : recovery;
      const recoveryHint = limited ? detail.applied === false
        ? 'Wait for the rate-limit window, then retry with the same input and existing _operationId. Mutations require a stable UUID _operationId.'
        : `Wait for the rate-limit window. ${recovery}` : statusRecovery;
      throw new ApiError(response.status, redact({ ...context, traceId, code: response.ok ? 'API_ERROR' : `HTTP_${response.status}`,
        message: `API request failed (${response.status}).`, ...detail, recovery: recoveryHint, ...timing,
        ...(result.operation ? { operation: result.operation } : {}) }, secrets) as Record<string, unknown>);
    }
    return result;
  }
}
