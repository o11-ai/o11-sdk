import { expect, test } from 'bun:test';
import { ReplayBuffer } from '../src/replay-buffer';
import { privateReplayEvent } from '../src/replay-privacy';
import { replayTransport } from '../src/replay-transport';
import { createTrackingClient } from '../src';
const recordingId = '00000000-0000-4000-8000-000000000001';
const windowId = '00000000-0000-4000-8000-000000000002';
const event = { type: 2, timestamp: 1000, data: { node: { type: 0, id: 1 } } };
test('chunks keep stable bytes/sequence across retries and finish declares every sealed segment', () => {
  const buffer = new ReplayBuffer(recordingId, windowId);
  expect(buffer.push(event)).toBe(true); buffer.seal();
  const first = buffer.peek()!;
  expect(buffer.peek()?.body).toBe(first.body);
  expect(first.chunk.sequence).toBe(0);
  buffer.acknowledge(); buffer.push({ ...event, timestamp: 2000 }); buffer.seal();
  expect(buffer.peek()?.chunk.sequence).toBe(1);
  buffer.restart(); buffer.push(event);
  expect(buffer.inventory().map(segment => segment.count)).toEqual([2, 1]);
  expect(buffer.inventory()[0]!.segmentId).not.toBe(buffer.inventory()[1]!.segmentId);
});
test('oversize structural events are rejected whole and buffered memory remains bounded', () => {
  const buffer = new ReplayBuffer(recordingId, windowId);
  expect(buffer.push({ ...event, data: { node: 'x'.repeat(1_000_001) } })).toBe(false);
  expect(buffer.push({ ...event, type: 3, data: { node: 'x'.repeat(240_001) } })).toBe(false);
  const large = { ...event, data: { node: 'x'.repeat(200_000) } };
  let accepted = 0;
  while (buffer.push(large)) accepted++;
  expect(accepted).toBeGreaterThan(0); expect(accepted).toBeLessThanOrEqual(10);
  expect(buffer.size).toBeLessThanOrEqual(2_000_000);
  expect(buffer.peek()!.bytes).toBeLessThanOrEqual(256_000);
  buffer.clear(); expect(buffer.size).toBe(0);
});
test('full snapshots upload whole beyond the incremental limit without losing preceding metadata', () => {
  const buffer = new ReplayBuffer(recordingId, windowId);
  buffer.push({ type: 4, timestamp: 1000, data: { href: 'https://app.example.com', width: 1000, height: 600 } });
  expect(buffer.push({ ...event, data: { node: 'x'.repeat(500_000) } })).toBe(true);
  expect(buffer.peek()!.chunk.events[0]!.type).toBe(4); buffer.acknowledge();
  expect(buffer.peek()!.chunk.events).toHaveLength(1); expect(buffer.peek()!.chunk.events[0]!.type).toBe(2);
  expect(buffer.peek()!.chunk.sequence).toBe(1); expect(buffer.peek()!.bytes).toBeLessThan(1_024_000);
  expect(buffer.inventory()[0]!.count).toBe(2);
});
test('privacy strips arbitrary attributes and URL credentials including CSS, without mutating original events', () => {
  const raw = { type: 2, timestamp: 1000, data: { href: 'https://user:secret@app.example.com/home?token=abc#private',
    node: { attributes: { value: 'private input', title: 'private title', 'data-email': 'private@example.com', srcset: 'private?token=abc',
      href: 'https://app.example.com/home?email=private', style: 'background:url("https://app.example.com/icon?token=abc");content:"private"', class: 'button',
      _cssText: '@import "https://app.example.com/styles?token=abc";.button{color:red}', rr_width: '100px' },
      tagName: 'style', childNodes: [{ type: 3, textContent: '.button{background:url("https://app.example.com/icon?token=abc");content:"private"}' }] } } };
  const safe = JSON.stringify(privateReplayEvent(raw));
  for (const secret of ['private', 'token=abc', 'user:secret', 'email=']) expect(safe).not.toContain(secret);
  expect(safe).toContain('class'); expect(safe).toContain('[masked]');
  expect(safe).toContain('_cssText'); expect(safe).toContain('rr_width'); expect(safe).toContain('color:red');
  expect(raw.data.node.attributes.value).toBe('private input');
});
test('transport uses origin-isolated credentials, gzip and bounded keepalive, and recognizes holds/rejections', async () => {
  const requests: RequestInit[] = [];
  const send = (async (_url: URL | RequestInfo, init?: RequestInit) => { requests.push(init!); return new Response(null, { status: 429, headers: { 'Retry-After': '60' } }); }) as typeof fetch;
  const transport = replayTransport('https://api.example.com/api/replay', send);
  const body = JSON.stringify({ data: 'x'.repeat(20_000) });
  const result = await transport('chunks', 'scoped-token', body);
  expect(result).toEqual({ accepted: false, terminal: false, retryAfterMs: 60_000 });
  const request = requests[0]!;
  expect(request.credentials).toBe('omit'); expect(request.redirect).toBe('error');
  expect(new Headers(request.headers).get('Content-Encoding')).toBe('gzip');
  const expanded = await new Response(new Blob([request.body as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  expect(expanded).toBe(body);
  await transport('chunks', 'token', body, true);
  expect(requests[1]!.keepalive).toBe(true); expect(requests[1]!.body).toBe(body);
  await transport('chunks', 'token', 'x'.repeat(50_000), true); expect(requests[2]!.keepalive).toBe(false);
  expect((await replayTransport('https://api.example.com/api/replay', async () => new Response(null, { status: 403 }))('chunks', 'token', '{}')).terminal).toBe(true);
  expect(() => replayTransport('https://user:secret@example.com/api/replay')).toThrow();
});
test('server replay session creation keeps the source secret server-side and validates scoped credentials', async () => {
  let request: RequestInit | undefined, target = '';
  const payload = { recordingId, token: `rpl_${'a'.repeat(64)}`, expiresAt: new Date(Date.now() + 60_000).toISOString(), enabled: true, sampleRate: 0.1 };
  const send = async (url: string | URL | Request, init?: RequestInit) => { request = init; target = String(url); return Response.json(payload); };
  const client = createTrackingClient({ endpoint: 'https://api.example.com/api/tracking/events', key: 'server-secret', environment: 'test', fetch: send });
  expect(await client.replaySession({ customerId: 'authenticated-customer', origin: 'https://app.example.com' })).toEqual(payload);
  expect(target).toBe('https://api.example.com/api/tracking/replay/session');
  expect(new Headers(request!.headers).get('X-O11-Environment')).toBe('test');
  expect(request!.redirect).toBe('error');
  await expect(client.replaySession({ customerId: '', origin: 'https://app.example.com' })).rejects.toThrow();
});
