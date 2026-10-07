import type { observePostHogReplay, PostHogReplayInstance } from './posthog-replay';
import { ReplayBuffer } from './replay-buffer';
import { privateReplayEvent } from './replay-privacy';
import { REPLAY_LIMITS, type ReplaySession, type ReplayStatus } from './replay-contract';
import { replayTransport, type ReplayFetch } from './replay-transport';
export type { PostHogReplayInstance } from './posthog-replay';
export type { ReplaySession, ReplayStatus } from './replay-contract';
export type ReplayOptions = { endpoint: string; session: () => Promise<ReplaySession>; consent: () => boolean;
  posthog?: PostHogReplayInstance; blockSelector?: string; approvedTextSelector?: string; onStatus?: (status: ReplayStatus) => void; fetch?: ReplayFetch };

export function createReplayClient(options: ReplayOptions) {
  const send = replayTransport(options.endpoint, options.fetch);
  let session: ReplaySession | undefined, consentSession: ReplaySession | undefined, buffer: ReplayBuffer | undefined, stopRecorder: (() => void) | undefined;
  let shared: ReturnType<typeof observePostHogReplay> | undefined;
  let releasePendingCapture = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, flushing: Promise<void> | undefined, generation = 0;
  let status: ReplayStatus = 'stopped', failures = 0, holdUntil = 0, incomplete = false;
  let expiresAtMonotonic = 0, captureAnchor = 0, serverAnchor = 0;
  const setStatus = (value: ReplayStatus) => { status = value; try { options.onStatus?.(value); } catch { /* Application callbacks never break capture. */ } };
  const permitted = () => { try { return options.consent(); } catch { return false; } };
  const halt = () => { running = false; releasePendingCapture(); releasePendingCapture = () => {}; shared?.cancel(); shared = undefined; stopRecorder?.(); stopRecorder = undefined; if (timer) clearTimeout(timer); timer = undefined;
    if (typeof window !== 'undefined') { window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', visibility); } };
  async function revokeConsent() {
    ++generation; halt(); buffer?.clear(); setStatus('stopped');
    const target = session ?? consentSession;
    if (target) {
      try { const result = await send('cancel', target.token, JSON.stringify({ recordingId: target.recordingId })); if (result.accepted) { session = undefined; consentSession = undefined; } return { deleted: result.accepted, retryable: !result.accepted && !result.terminal }; }
      catch { return { deleted: false, retryable: true }; }
    }
    return { deleted: false, retryable: false };
  }
  async function flush(keepalive = false) {
    if (flushing) return flushing;
    if (!permitted()) { await revokeConsent(); return; }
    const active = session, pending = buffer;
    if (!active || !pending || performance.now() < holdUntil) return;
    pending.seal();
    flushing = (async () => {
      while (pending.peek() && permitted()) {
        const item = pending.peek()!;
        try {
          const result = await send('chunks', active.token, item.body, keepalive);
          if (result.terminal) { halt(); pending.clear(); setStatus('failed'); return; }
          if (!result.accepted) { holdUntil = performance.now() + Math.max(result.retryAfterMs, Math.min(60_000, 1000 * 2 ** Math.min(++failures, 6))); return; }
          pending.acknowledge(); failures = 0;
        } catch { holdUntil = performance.now() + Math.min(60_000, 1000 * 2 ** Math.min(++failures, 6)); return; }
      }
    })().finally(() => { flushing = undefined; });
    return flushing;
  }
  const pagehide = () => { void flush(true).catch(() => setStatus('failed')); };
  const visibility = () => { if (document.visibilityState === 'hidden') void flush().catch(() => setStatus('failed')); };
  function schedule() {
    timer = setTimeout(() => {
      if (!running) return;
      if (!permitted()) { void revokeConsent(); return; }
      if (!session) { halt(); setStatus('stopped'); return; }
      if (expiresAtMonotonic <= performance.now() + 15_000) {
        const current = generation;
        // Close before the short-lived token expires, then authenticate a new
        // recording. A concurrent logout/reset invalidates this continuation.
        void stop().then(() => { if (generation === current + 1 && permitted()) return start(); }).catch(() => setStatus('failed'));
        return;
      }
      void flush().finally(() => { if (running) schedule(); });
    }, REPLAY_LIMITS.flushMs);
  }
  async function start() {
    if (running || status === 'starting') return;
    if (session) await stop();
    if (buffer?.pending) { setStatus('paused'); return; }
    if (typeof window === 'undefined') throw new Error('Replay capture requires a browser.');
    if (!permitted()) { setStatus('stopped'); return; }
    const current = ++generation; setStatus('starting');
    let releaseCapture = () => {}; let captureFailed = false, missedCapture = false; let captureId: string | undefined;
    const captureReady = new Promise<void>(resolve => { releaseCapture = resolve; });
    releasePendingCapture = releaseCapture;
    try {
      if (options.posthog && (options.blockSelector || options.approvedTextSelector)) throw new Error('Shared replay uses strict copy masking; selectors are native-only.');
      if (options.blockSelector) document.querySelector(options.blockSelector);
      if (options.approvedTextSelector) document.querySelector(options.approvedTextSelector);
      const adapter = options.posthog ? await import('./posthog-replay') : undefined;
      if (current !== generation) return;
      if (!permitted()) { setStatus('stopped'); return; }
      if (options.posthog) {
        let captured = false;
        let offset = 0;
        shared = adapter!.observePostHogReplay(options.posthog, {
          async event(event, source, boundary) {
            await captureReady;
            if (!running || !captureId || session?.recordingId !== captureId) return;
            if (!permitted()) { void revokeConsent(); return; }
            if (!captured) offset = serverAnchor - Date.now() + performance.now() - captureAnchor;
            const aligned = { ...event, timestamp: Math.floor(event.timestamp + offset) };
            if (aligned.timestamp < serverAnchor - 60_000 || aligned.timestamp > serverAnchor + performance.now() - captureAnchor + 60_000) throw new Error('Recording timestamp outside session.');
            if (boundary && captured) buffer?.restart();
            buffer?.setSource(source);
            if (!buffer?.push(aligned)) throw new Error('Recording buffer full.');
            captured = true; if (status !== 'recording') setStatus('recording');
          },
          failed() { captureFailed = true; incomplete = true; halt(); setStatus('failed'); },
          gap() { missedCapture = true; incomplete = true; },
        });
      }
      const next = await options.session();
      const receivedAt = performance.now();
      if (current !== generation || captureFailed) return;
      if (!permitted()) { setStatus('stopped'); return; }
      if (!next.enabled) { setStatus('sampled-out'); return; }
      const anchor = Date.parse(next.serverTime ?? new Date().toISOString());
      if (!/^[0-9a-f-]{36}$/i.test(next.recordingId) || !/^rpl_[a-f0-9]{64}$/.test(next.token) || !Number.isFinite(anchor) || !Number.isFinite(Date.parse(next.expiresAt)) || Date.parse(next.expiresAt) <= anchor || !Number.isFinite(next.sampleRate) || next.sampleRate < 0 || next.sampleRate > 1) { setStatus('failed'); return; }
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(next.recordingId));
      const sample = new DataView(bytes).getUint32(0) / 0x1_0000_0000;
      if (sample >= next.sampleRate) { setStatus('sampled-out'); return; }
      const native = options.posthog ? undefined : await import('@rrweb/record');
      if (current !== generation || captureFailed) return;
      if (!permitted()) { setStatus('stopped'); return; }
      session = next; captureId = next.recordingId; consentSession = next; incomplete = missedCapture; failures = 0; holdUntil = 0; buffer = new ReplayBuffer(next.recordingId, crypto.randomUUID()); running = true;
      serverAnchor = anchor; captureAnchor = receivedAt; expiresAtMonotonic = captureAnchor + Date.parse(next.expiresAt) - anchor;
      if (!options.posthog) stopRecorder = native!.record({ emit(event) {
        if (!running) return;
        if (!permitted()) { void revokeConsent(); return; }
        try {
          const aligned = { ...event, timestamp: Math.floor(serverAnchor + performance.now() - captureAnchor) };
          if (!buffer?.push(privateReplayEvent(aligned))) { incomplete = true; halt(); setStatus('paused'); void flush().catch(() => setStatus('failed')); }
        } catch { incomplete = true; halt(); setStatus('failed'); }
      }, maskAllInputs: true, maskTextSelector: '*', maskTextFn: (text, element) => options.approvedTextSelector && element?.closest(options.approvedTextSelector) && !element.closest('input, textarea, select, [contenteditable]') ? text : '[masked]', maskInputFn: () => '[masked]',
        blockSelector: ['[data-o11-block], canvas, video, audio, iframe', options.blockSelector].filter(Boolean).join(', '),
        recordCanvas: false, recordCrossOriginIframes: false, inlineImages: false, inlineStylesheet: true,
        checkoutEveryNms: 300_000, sampling: { mousemove: false, scroll: 150, input: 'last' } });
      if (!options.posthog && !stopRecorder) { incomplete = true; halt(); setStatus('failed'); return; }
      if (!running) { stopRecorder?.(); stopRecorder = undefined; return; }
      window.addEventListener('pagehide', pagehide); document.addEventListener('visibilitychange', visibility);
      setStatus(options.posthog ? 'waiting-for-replay' : 'recording'); schedule();
    } catch { halt(); setStatus('failed'); }
    finally { releaseCapture(); if (!running && current === generation) { shared?.cancel(); shared = undefined; } }
  }
  async function stop() {
    ++generation; shared?.unsubscribe(); if (!running) halt(); await shared?.drain();
    halt(); if (typeof window === 'undefined') { setStatus('stopped'); return; } window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', visibility);
    buffer?.seal();
    await flush();
    if (session && buffer && !buffer.pending && permitted()) {
      try { const result = await send('finish', session.token, JSON.stringify({ recordingId: session.recordingId, segments: buffer.inventory(), incomplete })); if (result.accepted || result.terminal) { buffer.clear(); session = undefined; } } catch { /* Retry finalization on the next stop/start; cron closes interrupted captures. */ }
    }
    setStatus('stopped');
  }
  return { start, stop, revokeConsent, flush: () => flush(), reset: async () => { await stop(); buffer?.clear(); session = undefined; consentSession = undefined; },
    get recordingId() { return session?.recordingId; }, get status() { return status; } };
}
