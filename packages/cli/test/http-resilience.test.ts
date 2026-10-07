import { expect, test } from 'bun:test';
import { render } from '../src/format';
import { ApiClient, ApiError, retryDelay, retryTiming } from '../src/http-client';
function sender(call: (request: Request) => Promise<Response>): typeof fetch { return Object.assign(async (url: string | URL | Request, init?: RequestInit) => call(new Request(url, init)), { preconnect: fetch.preconnect }); }
test('read retries honor short Retry-After and preserve diagnostic correlation', async () => {
  const ids: (string | null)[] = [];
  const api = new ApiClient(new URL('https://example.test'), undefined, 'token', sender(async request => { ids.push(request.headers.get('x-request-id')); return ids.length === 1 ? Response.json({ error: { code: 'BUSY' } }, { status: 503, headers: { 'Retry-After': '0' } }) : Response.json({ result: true }); }));
  expect(await api.request('status')).toEqual({ result: true }); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
});
test('long provider retry windows return without retrying early', async () => {
  let calls = 0;
  const api = new ApiClient(new URL('https://example.test'), undefined, undefined, sender(async () => { calls++; return Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429, headers: { 'Retry-After': '600' } }); }));
  await expect(api.request('status')).rejects.toBeInstanceOf(ApiError); expect(calls).toBe(1);
});
test('oversized successful writes retain operation IDs without reflecting payloads', async () => {
  const api = new ApiClient(new URL('https://example.test'), undefined, 'top-secret', sender(async () => Response.json({ result: 'provider-secret'.repeat(100) })));
  try { await api.request('execute/test', { _operationId: 'op' }, { maxBytes: 20 }); throw new Error('should reject'); }
  catch (error) { expect(error).toBeInstanceOf(ApiError); const details = (error as ApiError).details; expect(details.code).toBe('RESPONSE_TOO_LARGE'); expect(details.operationId).toBe('op'); expect(JSON.stringify(details)).not.toContain('secret'); }
});
test('network failures never expose credentials or provider exception contents', async () => {
  const api = new ApiClient(new URL('https://example.test'), undefined, 'token-secret', sender(async () => { throw new Error('provider-secret'); }));
  try { await api.request('execute/test', { _operationId: 'op' }); throw new Error('should reject'); }
  catch (error) { expect(error).toBeInstanceOf(ApiError); expect(JSON.stringify((error as ApiError).details)).not.toContain('secret'); expect((error as ApiError).details.operationId).toBe('op'); }
});
test('retry jitter is deterministic, bounded, and never shortens Retry-After', () => {
  expect(retryDelay(null, 0, () => 0)).toBe(250);
  expect(retryDelay(null, 1, () => 0.5)).toBe(750);
  expect(retryDelay('2', 0, () => 1)).toBe(2250);
  expect(retryDelay('5', 1, () => 1)).toBe(5000);
  expect(retryDelay('6', 0, () => 0)).toBeUndefined();
  expect(retryDelay('invalid', 0, () => 0)).toBeUndefined();
  expect(retryDelay('Thu, 01 Jan 1970 00:00:04 GMT', 1, () => 1, 0)).toBe(4500);
  expect(retryDelay('Thu, 01 Jan 1970 00:00:01 GMT', 1, () => 0, 2000)).toBe(0);
});
test('the overall request deadline cancels jitter without another request', async () => {
  let calls = 0;
  const api = new ApiClient(new URL('https://example.test'), undefined, undefined, sender(async () => { calls++; return Response.json({ error: { code: 'BUSY' } }, { status: 503, headers: { 'Retry-After': '0' } }); }), () => 1);
  try { await api.request('status', undefined, { timeoutMs: 20 }); throw new Error('should reject'); }
  catch (error) { expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).details.code).toBe('REQUEST_CANCELLED'); }
  expect(calls).toBe(1);
});

test('unstructured HTTP errors retain status and read-safe recovery', async () => {
  const api = new ApiClient(new URL('https://example.test'), undefined, undefined, sender(async () => Response.json({ unavailable: true }, { status: 503, headers: { 'Retry-After': '600' } })));
  await expect(api.request('status')).rejects.toMatchObject({ details: { code: 'HTTP_503', httpStatus: 503, recovery: 'Retry this read.' } });
});

test('ordinary query POSTs retry safely while operation-bearing writes stay single-attempt', async () => {
  for (const write of [false, true]) {
    let calls = 0;
    const api = new ApiClient(new URL('https://example.test'), undefined, undefined, sender(async () => { calls++; return calls === 1 ? Response.json({}, { status: 503, headers: { 'Retry-After': '0' } }) : Response.json({ result: true }); }), () => 0);
    const request = api.request('execute/example.operation', { organizationId: 'org', ...(write ? { _operationId: 'stable-operation' } : {}) });
    if (write) await expect(request).rejects.toMatchObject({ details: { operationId: 'stable-operation', httpStatus: 503 } });
    else expect(await request).toEqual({ result: true });
    expect(calls).toBe(write ? 1 : 2);
  }
});

test('long numeric and date retry windows survive JSON errors without an early retry', async () => {
  for (const header of ['60', new Date(Date.now() + 60_000).toUTCString()]) {
    let calls = 0;
    const api = new ApiClient(new URL('https://example.test'), undefined, undefined, sender(async () => {
      calls++; return Response.json({ error: { code: 'RATE_LIMITED', applied: false, retryable: true } }, { status: 429, headers: { 'Retry-After': header } });
    }));
    try { await api.request('status'); throw new Error('should reject'); }
    catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const output = JSON.parse(render({ error: (error as ApiError).details }, true)) as { error: Record<string, unknown> };
      expect(output.error).toMatchObject({ code: 'RATE_LIMITED', applied: false, retryable: true, httpStatus: 429 });
      expect(Number(output.error.retryAfterMs)).toBeGreaterThan(50_000);
      expect(Number(output.error.retryAfterMs)).toBeLessThanOrEqual(60_000);
      expect(Date.parse(String(output.error.retryAt))).toBeGreaterThan(Date.now() + 50_000);
    }
    expect(calls).toBe(1);
  }
});

test('invalid and excessive Retry-After values do not create scheduling hints', () => {
  for (const value of ['-1', '1.5', 'invalid', 'Infinity', '999999999999999999999999999999', '604801']) expect(retryTiming(value)).toBeUndefined();
  expect(retryTiming('600', 0)).toEqual({ retryAfterMs: 600_000, retryAt: '1970-01-01T00:10:00.000Z' });
  expect(retryTiming('Thu, 01 Jan 1970 00:00:04 GMT', 0)).toEqual({ retryAfterMs: 4000, retryAt: '1970-01-01T00:00:04.000Z' });
});

test('preexecution throttling retains the write ID and timing without automatically repeating a write', async () => {
  const inputs: Record<string, unknown>[] = [], id = crypto.randomUUID();
  const api = new ApiClient(new URL('https://example.test'), undefined, undefined, sender(async request => {
    inputs.push(await request.json() as Record<string, unknown>);
    return Response.json({ error: { code: 'RATE_LIMITED', applied: false, retryable: true } }, { status: 429, headers: { 'Retry-After': '0' } });
  }));
  await expect(api.request('execute/research.runtimeCheck', { _operationId: id })).rejects.toMatchObject({ details: {
    operationId: id, code: 'RATE_LIMITED', applied: false, retryAfterMs: 0,
    recovery: 'Wait for the rate-limit window, then retry with the same input and existing _operationId. Mutations require a stable UUID _operationId.',
  } });
  expect(inputs).toEqual([{ _operationId: id }]);
});

test('a mutation refusal without an operation ID never tells the caller to retry a read', async () => {
  let calls = 0;
  const api = new ApiClient(new URL('https://example.test'), undefined, undefined, sender(async () => {
    calls++; return Response.json({ error: { code: 'OPERATION_FAILED', message: 'Every mutation requires a UUID _operationId.' } }, { status: 422 });
  }));
  try { await api.request('execute/research.runtimeCheck', { organizationId: 'org' }); throw new Error('should reject'); }
  catch (error) {
    const details = (error as ApiError).details;
    expect(details.httpStatus).toBe(422); expect(details.code).toBe('OPERATION_FAILED');
    expect(String(details.recovery)).toContain('stable UUID _operationId');
    expect(String(details.recovery)).not.toContain('Retry this read');
  }
  expect(calls).toBe(1);
});


test('read refusals identify authentication, grant and input repairs without repeating the request', async () => {
  for (const [status, hint] of [[401, 'Reconnect the correct profile'], [403, 'required scopes and workspace grant'], [404, 'resource ID'], [400, 'correct the request input'], [422, 'correct the request input']] as const) {
    let calls = 0;
    const api = new ApiClient(new URL('https://example.test'), undefined, 'existing-token', sender(async () => {
      calls++; return Response.json({ error: { code: 'REFUSED' } }, { status });
    }));
    try { await api.request('commands/research.runtimeCheck'); throw new Error('should reject'); }
    catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const details = (error as ApiError).details;
      expect(details.httpStatus).toBe(status);
      expect(String(details.recovery)).toContain(hint);
      expect(String(details.recovery)).not.toContain('Retry this read');
    }
    expect(calls).toBe(1);
  }
});

test('write validation failure preserves its receipt guidance and stable operation ID', async () => {
  let calls = 0; const operationId = crypto.randomUUID();
  const api = new ApiClient(new URL('https://example.test'), undefined, undefined, sender(async () => {
    calls++; return Response.json({ error: { code: 'INVALID_INPUT' } }, { status: 422 });
  }));
  try { await api.request('execute/research.runtimeCheck', { _operationId: operationId }); throw new Error('should reject'); }
  catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const details = (error as ApiError).details;
    expect(details.operationId).toBe(operationId);
    expect(String(details.recovery)).toContain('correct the request input');
    expect(String(details.recovery)).toContain('inspect its operation receipt');
    expect(String(details.recovery)).not.toContain('Retry this read');
  }
  expect(calls).toBe(1);
});
test('schema-confirmed query errors give read recovery and never imply an uncertain write', async () => {
  for (const response of [() => Response.json({ error: { code: 'UNAVAILABLE' } }, { status: 503, headers: { 'Retry-After': '600' } }), () => new Response('bad gateway', { status: 502 }), () => new Response('{', { headers: { 'Content-Type': 'application/json' } })]) {
    const api = new ApiClient(new URL('https://example.test'), undefined, undefined, sender(async () => response()));
    try { await api.request('execute/signals.resources', { kind: 'events' }, { mutation: false }); throw new Error('should reject'); }
    catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).details.recovery).toBe('Retry this read.');
      expect(JSON.stringify((error as ApiError).details)).not.toContain('write');
    }
  }
});
