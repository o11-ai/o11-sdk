import { describe, expect, test } from 'bun:test';
import { createTrackingClient, validEvent, type TrackingEvent } from '../src';
const event: TrackingEvent = { eventId: 'report.created:1', name: 'report.created', customerId: 'customer:1', occurredAt: '2026-10-02T00:00:00.000Z', properties: { reportId: '1' } };
describe('server tracking contract', () => {
  test('rejects invalid identities, private nested content and unsafe URLs before sending', () => {
    expect(validEvent({ ...event, customerId: '' })).toBe(false);
    expect(validEvent({ ...event, customerId: 'x'.repeat(129) })).toBe(false);
    expect(validEvent({ ...event, properties: { size: NaN } })).toBe(false);
    expect(() => createTrackingClient({ environment: "test", endpoint: 'http://example.com/events', key: 'secret' })).toThrow('HTTPS');
    expect(() => createTrackingClient({ environment: "test", endpoint: 'https://user:secret@example.com/events', key: 'secret' })).toThrow();
    expect(() => createTrackingClient({ environment: "test", endpoint: 'https://example.com/events', key: 'secret', attempts: NaN })).toThrow();
  });
  test('sends a stable event with authorization and refuses redirects', async () => {
    const requests: RequestInit[] = [];
    const send = (async (_url: URL | RequestInfo, init?: RequestInit) => { requests.push(init!); return Response.json({accepted:true,receiptId:"00000000-0000-4000-8000-000000000001"}, {status:202}); }) as typeof fetch;
    const result = await createTrackingClient({ environment: "test", endpoint: 'https://example.com/events', key: 'source-secret', fetch: send }).track(event);
    expect(result).toEqual({ accepted: true, retryable: false, status: 202, receiptId: "00000000-0000-4000-8000-000000000001" });
    expect(requests[0].redirect).toBe('manual');
    expect(JSON.parse(String(requests[0].body))).toEqual(event);
  });
  test('does not retry authorization or schema failures', async () => {
    let calls = 0;
    const send = async () => { calls++; return new Response(null, { status: 422 }); };
    expect((await createTrackingClient({ environment: "test", endpoint: 'https://example.com/events', key: 'key', fetch: send }).track(event)).retryable).toBe(false);
    expect(calls).toBe(1);
  });
  test('preserves the payload on bounded retries and reports exhaustion', async () => {
    const bodies: unknown[] = [];
    const send = (async (_url: URL | RequestInfo, init?: RequestInit) => { bodies.push(init?.body); return new Response(null, { status: 503 }); }) as typeof fetch;
    const receipt = await createTrackingClient({ environment: "test", endpoint: 'https://example.com/events', key: 'key', fetch: send, attempts: 2 }).track(event);
    expect(receipt).toEqual({ accepted: false, retryable: true, status: 503, code: "delivery_unconfirmed" });
    expect(bodies).toEqual([JSON.stringify(event), JSON.stringify(event)]);
  });
});

test('long rate limit holds are returned to the durable outbox without sleeping', async () => {
  let calls = 0;
  const send = async () => { calls++; return Response.json({code: 'rate_limited'}, {status: 429, headers: {'Retry-After': '60'}}); };
  const result = await createTrackingClient({environment: 'test', endpoint:'https://example.test/api/tracking/events',key:'secret',fetch:send}).track(event);
  expect(result).toMatchObject({accepted:false,retryable:true,status:429,code:'rate_limited',retryAfterMs:60000});
  expect(calls).toBe(1);
});
test('Worker-compatible transport refuses redirected writes and receipt reads without retrying', async () => {
  const id = crypto.randomUUID();
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    const client = createTrackingClient({ environment: 'test', endpoint: 'https://example.test/api/tracking/events', key: 'secret', fetch: async (_url, init) => {
      calls++;
      if (init?.redirect === 'error') throw new TypeError('Unsupported Worker redirect mode');
      expect(init?.redirect).toBe('manual');
      return new Response(null, { status, headers: { Location: 'https://attacker.test/collect' } });
    } });
    expect(await client.track(event)).toEqual({ accepted: false, retryable: false, status, code: 'redirect_rejected' });
    expect(await client.receipt(id)).toBeNull();
    expect(calls).toBe(2);
  }
});
test('profiles and receipt inspection retain source authentication and isolated environment', async () => {
  const id = crypto.randomUUID(), paths: string[] = [];
  const send = async (url: string | URL | Request, init?: RequestInit) => {
    paths.push(String(url));
    expect(init?.headers).toMatchObject({'X-O11-Environment':'test',Authorization:'Bearer secret'});
    return init?.method === 'GET' ? Response.json({id,kind:'profile',status:'processed',code:'profile_synced',processedAt:null}) : Response.json({accepted:true,receiptId:id},{status:202});
  };
  const client = createTrackingClient({environment:'test',endpoint:'https://example.test/api/tracking/events',key:'secret',fetch:send});
  expect((await client.identify({operationId:id,customerId:'1',updatedAt:event.occurredAt,contacts:[],permissions:[]})).accepted).toBe(true);
  expect((await client.receipt(id))?.status).toBe('processed');
  expect(paths).toEqual(['https://example.test/api/tracking/profiles',`https://example.test/api/tracking/receipts/${id}`]);
});
test('a successful HTTP response without a receipt is not proven acceptance', async () => {
  const client = createTrackingClient({environment:'test',endpoint:'https://example.test/events',key:'secret',fetch:async () => new Response(null,{status:202})});
  expect(await client.track(event)).toMatchObject({accepted:false,retryable:true,code:'invalid_response'});
});
test('development runtimes reject accidentally selected production credentials', () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV='development';
  try { expect(() => createTrackingClient({endpoint:'https://example.test/events',key:'secret',environment:'production'})).toThrow('development tracking key'); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=previous; }
});
