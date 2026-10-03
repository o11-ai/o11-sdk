import { describe, expect, test } from 'bun:test';
import { createTrackingClient, validEvent, type TrackingEvent } from '../src';
const event: TrackingEvent = { eventId: 'report.created:1', name: 'report.created', customerId: 'customer:1', occurredAt: '2026-10-02T00:00:00.000Z', properties: { reportId: '1' } };
describe('server tracking contract', () => {
  test('rejects invalid identities, private nested content and unsafe URLs before sending', () => {
    expect(validEvent({ ...event, customerId: '' })).toBe(false);
    expect(validEvent({ ...event, customerId: 'x'.repeat(129) })).toBe(false);
    expect(validEvent({ ...event, properties: { size: NaN } })).toBe(false);
    expect(() => createTrackingClient({ endpoint: 'http://example.com/events', key: 'secret' })).toThrow('HTTPS');
    expect(() => createTrackingClient({ endpoint: 'https://user:secret@example.com/events', key: 'secret' })).toThrow();
    expect(() => createTrackingClient({ endpoint: 'https://example.com/events', key: 'secret', attempts: NaN })).toThrow();
  });
  test('sends a stable event with authorization and refuses redirects', async () => {
    const requests: RequestInit[] = [];
    const send = (async (_url: URL | RequestInfo, init?: RequestInit) => { requests.push(init!); return new Response(null, { status: 202 }); }) as typeof fetch;
    const result = await createTrackingClient({ endpoint: 'https://example.com/events', key: 'source-secret', fetch: send }).track(event);
    expect(result).toEqual({ accepted: true, retryable: false, status: 202 });
    expect(requests[0].redirect).toBe('error');
    expect(JSON.parse(String(requests[0].body))).toEqual(event);
  });
  test('does not retry authorization or schema failures', async () => {
    let calls = 0;
    const send = async () => { calls++; return new Response(null, { status: 422 }); };
    expect((await createTrackingClient({ endpoint: 'https://example.com/events', key: 'key', fetch: send }).track(event)).retryable).toBe(false);
    expect(calls).toBe(1);
  });
  test('preserves the payload on bounded retries and reports exhaustion', async () => {
    const bodies: unknown[] = [];
    const send = (async (_url: URL | RequestInfo, init?: RequestInit) => { bodies.push(init?.body); return new Response(null, { status: 503 }); }) as typeof fetch;
    const receipt = await createTrackingClient({ endpoint: 'https://example.com/events', key: 'key', fetch: send, attempts: 2 }).track(event);
    expect(receipt).toEqual({ accepted: false, retryable: true, status: 503 });
    expect(bodies).toEqual([JSON.stringify(event), JSON.stringify(event)]);
  });
});
