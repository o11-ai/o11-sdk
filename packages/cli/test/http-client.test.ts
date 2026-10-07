import { expect, test } from 'bun:test';
import { ApiClient, ApiError } from '../src/http-client';
import { readInput } from '../src/arguments';
import { render } from '../src/format';
import { serverUrl } from '../src/profile';

test('one direct JSON request executes a command without MCP discovery or a session', async () => {
  const requests: Request[] = [];
  const send: typeof fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(url, init)); return Response.json({ result: { id: 'routine' } });
  }, { preconnect: fetch.preconnect });
  const api = new ApiClient(new URL('https://example.test/api/mcp'), undefined, 'scoped-token', send);
  expect(await api.request('execute/engagement.routines.get', { id: 'routine' })).toEqual({ result: { id: 'routine' } });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://example.test/api/agent/v1/execute/engagement.routines.get');
  expect(requests[0]!.method).toBe('POST');
  expect(requests[0]!.headers.get('accept')).toBe('application/json');
  expect(requests[0]!.headers.get('authorization')).toBe('Bearer scoped-token');
  expect(requests[0]!.headers.has('mcp-protocol-version')).toBe(false);
  expect(await requests[0]!.json()).toEqual({ id: 'routine' });
});

test('authentication refresh retries once; permission, server and network failures never retry writes', async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0, refreshes = 0;
    const send: typeof fetch = Object.assign(async () => { calls++; return status === 401 && calls === 2 ? Response.json({ result: true }) : Response.json({ error: { code: 'REFUSED', message: 'Refused.' } }, { status }); }, { preconnect: fetch.preconnect });
    const api = new ApiClient(new URL('https://example.test/api/mcp'), { token: async () => 'token', onUnauthorized: async () => { refreshes++; } }, undefined, send);
    if (status === 401) expect(await api.request('execute/test', { _operationId: 'same-id' })).toEqual({ result: true });
    else await expect(api.request('execute/test', { _operationId: 'same-id' })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(status === 401 ? 2 : 1); expect(refreshes).toBe(status === 401 ? 1 : 0);
  }
  let calls = 0;
  const send: typeof fetch = Object.assign(async () => { calls++; throw new Error('network unavailable'); }, { preconnect: fetch.preconnect });
  await expect(new ApiClient(new URL('https://example.test'), undefined, 'key', send).request('execute/test', {})).rejects.toThrow('Network request failed');
  expect(calls).toBe(1);
});

test('CLI flags preserve string IDs, enforce numeric fields and refuse conflicting input', async () => {
  expect(await readInput({ id: '001', environment: 'test', revision: '2', set: ['enabled=false', 'nodes=[]'] })).toEqual({ id: '001', environment: 'test', revision: 2, enabled: false, nodes: [] });
  await expect(readInput({ revision: 'not-a-number' })).rejects.toThrow();
  await expect(readInput({ id: 'one', set: ['id="two"'] })).rejects.toThrow('Conflicting');
  await expect(readInput({ set: ['__proto__={}'] })).rejects.toThrow();
  expect(serverUrl('https://example.test').href).toBe(serverUrl('https://example.test/api/mcp').href);
});

test('credential loading and refresh failures remain authentication errors without leaking provider secrets', async () => {
  for (const stage of ['token', 'refresh', 'refreshed-token']) {
    let calls = 0, tokens = 0, refreshes = 0, cancelled = false;
    const operationId = crypto.randomUUID();
    const send: typeof fetch = Object.assign(async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 401 });
    }, { preconnect: fetch.preconnect });
    const api = new ApiClient(new URL('https://example.test'), {
      async token() {
        tokens++;
        if (stage === 'token' || (stage === 'refreshed-token' && tokens === 2)) throw new Error('expired provider-secret-token');
        return 'provider-secret-token';
      },
      async onUnauthorized() { refreshes++; if (stage === 'refresh') throw new Error('consent missing provider-secret-token'); },
    }, undefined, send);
    try { await api.request('execute/test.write', { _operationId: operationId }); throw new Error('Expected authentication failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).details).toMatchObject({ code: 'AUTHENTICATION_REQUIRED', httpStatus: 401, applied: false, operationId });
      expect(JSON.stringify((error as ApiError).details)).not.toContain('provider-secret-token');
      expect((error as Error).message).toContain('Reconnect');
    }
    expect(calls).toBe(stage === 'token' ? 0 : 1);
    expect(refreshes).toBe(stage === 'token' ? 0 : 1);
    expect(cancelled).toBe(stage !== 'token');
  }
});

test('human output and command help are readable, JSON retains metadata', () => {
  const response = { result: [{ id: 'r1', name: 'Welcome', revision: 2 }], page: { nextOffset: 1 } };
  expect(render(response, false)).toContain('r1\tWelcome\t2');
  expect(JSON.parse(render(response, true))).toEqual(response);
  const help = render({ result: { command: 'routines get', inputSchema: { allOf: [{ properties: { id: { type: 'string' } }, required: ['id'] }] } } }, false);
  expect(help).toContain('o11 routines get'); expect(help).toContain('--id  string (required)');
});


test('notification webhook targets are redacted from echoed API failures', async () => {
  for (const target of ['https://hooks.slack.com/services/team/channel/private-token', 'https://discord.com/api/webhooks/123/private-token']) {
    const send: typeof fetch = Object.assign(async () => Response.json({ error: { message: `Rejected ${target}` } }, { status: 422 }), { preconnect: fetch.preconnect });
    const api = new ApiClient(new URL('https://example.test'), undefined, 'saved-token', send);
    try {
      await api.request('execute/engagement.personas.notifications.create', { target, _operationId: crypto.randomUUID() });
      throw new Error('Expected a rejected request');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(JSON.stringify((error as ApiError).details)).not.toContain('private-token');
      expect((error as Error).message).toContain('[redacted]');
    }
  }
});
