import { terminalState } from './health';
export interface WaitOptions { timeoutMs: number; intervalMs: number; signal?: AbortSignal; changed?: (value: Record<string, unknown>) => void; }
const ignored = new Set(['checkedAt', 'requestId', 'traceId']);
function stable(value: unknown): string { return JSON.stringify(value, (key, item: unknown) => ignored.has(key) ? undefined : item); }
export async function waitFor(read: (signal: AbortSignal) => Promise<Record<string, unknown>>, options: WaitOptions) {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1 || !Number.isFinite(options.intervalMs) || options.intervalMs < 10) throw new Error('Polling needs a positive deadline and an interval of at least 10 milliseconds.');
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs), ...(options.signal ? [options.signal] : [])]);
  let previous: string | undefined, latest: Record<string, unknown> | undefined;
  try {
    while (!signal.aborted) {
      latest = await read(signal);
      const state = terminalState(latest), digest = stable(latest);
      if (digest !== previous) { options.changed?.(latest); previous = digest; }
      if (state !== 'pending') return { state, result: latest };
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, options.intervalMs);
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      });
    }
  } catch (error) { if (!signal.aborted) throw error; }
  return { state: options.signal?.aborted ? 'cancelled' : 'timeout', result: latest, message: 'Local waiting stopped. Remote work was not cancelled.' };
}
