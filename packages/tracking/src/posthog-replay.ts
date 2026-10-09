import { REPLAY_LIMITS, type ReplayEvent, type ReplayCaptureSource } from './replay-contract';
import { decodePostHogEvent, object, posthogCopyPrivacy } from './posthog-replay-data';
export type PostHogReplayInstance = { on(event: 'eventCaptured', callback: (capture: unknown) => void): () => void };
export type PostHogReplaySink = { event(event: ReplayEvent, source: ReplayCaptureSource, boundary: boolean): void | Promise<void>; failed(error: Error): void; gap?(): void };
export function observePostHogReplay(instance: PostHogReplayInstance, sink: PostHogReplaySink) {
  let active = true, bytes = 0, stream = '', ready = false;
  let privacy = posthogCopyPrivacy(), pending = Promise.resolve();
  const seen = new Set<string>();
  let metadata: ReplayEvent | null = null;
  const fail = (cause: unknown = new Error('Recording copy exceeds supported limits.')) => { if (active) { active = false; try { sink.failed(cause instanceof Error ? cause : new Error('Could not copy recording.')); } catch { /* Isolate all application callbacks. */ } } };
  const unsubscribe = instance.on('eventCaptured', capture => {
    // This hook executes before PostHog uploads. Nothing may escape it, including
    // serialization, compression, getters and application callbacks.
    try {
      if (!active) return;
      const raw = object(capture); if (raw.event !== '$snapshot') return;
      const original = object(raw.properties);
      const serialized = JSON.stringify({ uuid: raw.uuid, properties: { $lib_version: original.$lib_version, $session_id: original.$session_id, $window_id: original.$window_id, $snapshot_data: original.$snapshot_data } });
      const size = new TextEncoder().encode(serialized).byteLength;
      if (size + bytes > REPLAY_LIMITS.bufferBytes) { fail(); return; }
      const copy = object(JSON.parse(serialized)); // functions are not wire data
      const properties = object(copy.properties);
      const version = typeof properties.$lib_version === 'string' ? properties.$lib_version.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 64) || 'unknown' : 'unknown';
      if (typeof copy.uuid !== 'string' || copy.uuid.length > 128 || typeof properties.$session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(properties.$session_id) || typeof properties.$window_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(properties.$window_id) || !Array.isArray(properties.$snapshot_data) || properties.$snapshot_data.length > REPLAY_LIMITS.events) { fail(); return; }
      if (seen.has(copy.uuid)) return;
      seen.add(copy.uuid); if (seen.size > 2000) seen.delete(seen.values().next().value!);
      const source: ReplayCaptureSource = { provider: 'posthog', sdkVersion: version, sessionId: properties.$session_id, windowId: properties.$window_id };
      bytes += size;
      pending = pending.then(async () => {
        if (!active) return;
        const key = `${source.sessionId}:${source.windowId}`;
        if (key !== stream) { stream = key; ready = false; privacy = posthogCopyPrivacy(); metadata = null; }
        for (const value of properties.$snapshot_data as unknown[]) {
          const decoded = await decodePostHogEvent(value);
          if (!active) return;
          let boundary = !ready;
          if (!ready && decoded.type !== 2) {
            if (decoded.type === 4) metadata = privacy(decoded);
            if (decoded.type === 3) sink.gap?.();
            continue;
          } // late attachment waits for a real full snapshot
          const event = privacy(decoded); if (!event) continue;
          if (boundary && metadata) { await sink.event(metadata, source, true); metadata = null; boundary = false; }
          ready = true; await sink.event(event, source, boundary);
        }
      }).catch(fail).finally(() => { bytes -= size; });
    } catch (error) { fail(error); }
  });
  return {
    unsubscribe: () => { try { unsubscribe(); } catch { /* PostHog remains independent. */ } },
    drain: () => pending,
    cancel: () => { active = false; try { unsubscribe(); } catch { /* Independent lifecycle. */ } },
  };
}
