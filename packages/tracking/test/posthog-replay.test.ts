import { expect, test } from 'bun:test';
import { observePostHogReplay, type PostHogReplayInstance } from '../src/posthog-replay';
import { decodePostHogEvent, posthogCopyPrivacy } from '../src/posthog-replay-data';
import { ReplayBuffer } from '../src/replay-buffer';
const id = '00000000-0000-4000-8000-000000000001';
const snapshot = { type: 2, timestamp: Date.now(), data: { node: { type: 0, id: 0, childNodes: [{ type: 2, id: 1, tagName: 'div', attributes: {}, childNodes: [{ type: 3, id: 2, textContent: 'private page text' }] }] }, initialOffset: { left: 0, top: 0 } } };
function fixture() {
  let listener: ((capture: unknown) => void) | undefined, unsubscribed = 0;
  const instance: PostHogReplayInstance = { on(_event, callback) { listener = callback; return () => { unsubscribed++; listener = undefined; }; } };
  return { instance, emit: (capture: unknown) => listener?.(capture), get unsubscribed() { return unsubscribed; } };
}
const batch = (events: unknown[], version = '1.438.1') => ({ uuid: crypto.randomUUID(), event: '$snapshot', properties: { $lib_version: version, $session_id: id, $window_id: id, $snapshot_data: events } });
test('accepts known recording formats across SDK versions, deduplicates batches, waits for full snapshots and never mutates originals', async () => {
  for (const version of ['1.335.2', '1.438.1', '1.439.0', '2.0.0-beta.1', 'development', 'unknown']) {
    const ph = fixture(), received: unknown[] = []; let failed = false;
    const adapter = observePostHogReplay(ph.instance, { event: (event, source, boundary) => { received.push({ event, source, boundary }); }, failed: () => { failed = true; } });
    ph.emit(batch([{ type: 3, timestamp: Date.now(), data: { source: 5, id: 1, text: 'private input' } }], version));
    const raw = batch([snapshot, { type: 5, timestamp: Date.now(), data: { callback: () => {}, secret: 'private custom' } }], version), before = JSON.stringify(raw);
    ph.emit(raw); ph.emit(raw); await adapter.drain();
    expect(received).toHaveLength(1); expect(JSON.stringify(received)).not.toContain('private');
    expect(JSON.stringify(raw)).toBe(before); expect(failed).toBe(false);
    adapter.cancel(); expect(ph.unsubscribed).toBe(1);
  }
});
test('format, serialization failures and sink failures never escape PostHog callback', async () => {
  const circular: Record<string, unknown> = { event: '$snapshot' }; circular.self = circular;
  for (const raw of [batch([{ ...snapshot, type: 7 }]), batch([{ ...snapshot, cv: 'future' }]), circular, batch([snapshot])]) {
    const ph = fixture(); let failed = 0;
    const adapter = observePostHogReplay(ph.instance, { event: () => { throw new Error('sink unavailable'); }, failed: () => { failed++; throw new Error('bad callback'); } });
    expect(() => ph.emit(raw)).not.toThrow(); await adapter.drain(); expect(failed).toBe(1);
    adapter.cancel();
  }
});
test('decompresses bounded supported fields and refuses expansion/format changes', async () => {
  const compress = async (value: unknown) => { const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); return Array.from(bytes, byte => String.fromCharCode(byte)).join(''); };
  expect(await decodePostHogEvent({ ...snapshot, cv: '2024-10', data: await compress(snapshot.data) })).toEqual(snapshot);
  const texts = [{ id: 2, value: 'private' }];
  const mutation = { type: 3, timestamp: Date.now(), cv: '2024-10', data: { source: 0, texts: await compress(texts), attributes: [], adds: [], removes: [] } };
  expect((await decodePostHogEvent(mutation)).data).toEqual({ ...mutation.data, texts });
  await expect(decodePostHogEvent({ ...snapshot, cv: 'future' })).rejects.toThrow();
  await expect(decodePostHogEvent({ ...snapshot, cv: '2024-10', data: await compress({ secret: 'x'.repeat(1_000_001) }) })).rejects.toThrow();
});
test('privacy excludes blocked/media descendants, arbitrary plugin fields and text/input mutations', () => {
  const redact = posthogCopyPrivacy();
  const raw = { ...snapshot, data: { ...snapshot.data, secret: 'private extra', node: { type: 0, id: 0, childNodes: [{ type: 2, id: 10, tagName: 'div', attributes: { 'data-o11-block': '' }, childNodes: [{ type: 3, id: 11, textContent: 'private blocked' }] }] } } };
  expect(JSON.stringify(redact(raw))).not.toContain('private');
  const mutation = redact({ type: 3, timestamp: Date.now(), data: { source: 0, texts: [{ id: 11, value: 'private' }], attributes: [], removes: [], adds: [{ parentId: 10, node: { type: 3, id: 12, textContent: 'private' } }] } });
  expect(mutation?.data).toEqual({ source: 0, texts: [], attributes: [], removes: [], adds: [] });
  expect(redact({ type: 3, timestamp: Date.now(), data: { source: 5, id: 20, text: 'private', arbitrary: 'private' } })?.data).toEqual({ source: 5, id: 20, text: '[masked]' });
  expect(redact({ type: 6, timestamp: Date.now(), data: { secret: 'private' } })).toBeNull();
});
test('shared chunks preserve real source version and source identities across segment boundaries', () => {
  const buffer = new ReplayBuffer(id, id), source = { provider: 'posthog' as const, sdkVersion: '1.438.1', sessionId: id, windowId: id };
  buffer.setSource(source); buffer.push(snapshot); buffer.seal();
  expect(buffer.peek()?.chunk.recorderVersion).toBe('posthog-js:1.438.1'); expect(buffer.peek()?.chunk.captureSource).toEqual(source);
  buffer.restart(); buffer.setSource({ ...source, sessionId: crypto.randomUUID() }); buffer.push(snapshot);
  expect(buffer.inventory()).toHaveLength(2);
});
