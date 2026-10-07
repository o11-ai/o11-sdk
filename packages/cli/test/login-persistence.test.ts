import { expect, test, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { credentialStore } from '../src/vault';
import { login } from '../src/login';

test('login reuses grants, rotates expired access, and explicitly reauthenticates on the same profile', async () => {
  const previous = process.env.O11_CONFIG_DIR;
  const root = await mkdtemp(join(tmpdir(), 'o11-persistent-login-'));
  process.env.O11_CONFIG_DIR = root;
  let refreshes = 0, exchanges = 0, unavailable = false;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/token') {
      if (unavailable) return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
      const body = new URLSearchParams(await request.text());
      if (body.get('grant_type') === 'refresh_token') {
        refreshes++;
        expect(body.get('refresh_token')).toBe('retained-refresh');
        return Response.json({ access_token: 'valid', token_type: 'Bearer', expires_in: 300 });
      }
      exchanges++;
      expect(body.get('code')).toBe('synthetic-code');
      expect(body.get('code_verifier')).toBeTruthy();
      return Response.json({ access_token: 'valid', refresh_token: 'fresh-refresh', token_type: 'Bearer', scope: 'o11:read o11:configure offline_access', expires_in: 300 });
    }
    if (url.pathname.includes('oauth-protected-resource')) return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin], scopes_supported: ['o11:read', 'o11:configure', 'offline_access'] });
    if (url.pathname.includes('oauth-authorization-server')) return Response.json({ issuer: url.origin, token_endpoint: `${url.origin}/token`, authorization_endpoint: `${url.origin}/authorize`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], scopes_supported: ['o11:read', 'o11:configure', 'offline_access'] });
    if (url.pathname === '/api/agent/v1/status') return request.headers.get('authorization') === 'Bearer valid'
      ? Response.json({ result: { organizationId: 'workspace' } }) : new Response(null, { status: 401 });
    return new Response(null, { status: 404 });
  } });
  const endpoint = new URL('mcp', server.url), issuer = server.url.origin;
  const store = await credentialStore('persistent', endpoint, 'file');
  const seed = (access_token: string) => store.write(JSON.stringify({ clients: { [issuer]: { client_id: 'test-client', issuer } },
    tokens: { access_token, refresh_token: 'retained-refresh', token_type: 'Bearer', scope: 'o11:read o11:configure offline_access', issuer },
    discovery: { authorizationServerUrl: issuer, authorizationServerMetadata: { issuer, token_endpoint: `${issuer}/token`, authorization_endpoint: `${issuer}/authorize`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] }, resourceMetadata: { resource: endpoint.href, authorization_servers: [issuer] } } }));
  const callbacks: Promise<Response>[] = [];
  const output = spyOn(process.stderr, 'write').mockImplementation(chunk => {
    const line = String(chunk), link = line.match(/http:\/\/127\.0\.0\.1:\d+\/authorize\?[^\s]+/)?.[0];
    if (link) {
      const authorization = new URL(link), callback = new URL(authorization.searchParams.get('redirect_uri')!);
      callback.searchParams.set('code', 'synthetic-code');
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      callback.searchParams.set('iss', issuer);
      callbacks.push(fetch(callback));
    }
    return true;
  });
  try {
    await seed('valid');
    const options = { credentialStore: 'file' as const, noBrowser: true };
    expect(await login(endpoint, 'persistent', 'o11:read o11:configure', options)).toMatchObject({ result: { organizationId: 'workspace' } });
    expect(refreshes).toBe(0); expect(exchanges).toBe(0); expect(callbacks).toHaveLength(0);
    await seed('expired');
    expect(await login(endpoint, 'persistent', undefined, options)).toMatchObject({ result: { organizationId: 'workspace' } });
    expect(refreshes).toBe(1); expect(callbacks).toHaveLength(0);
    expect(JSON.parse((await store.read())!).tokens.refresh_token).toBe('retained-refresh');
    await seed('expired'); unavailable = true;
    await expect(login(endpoint, 'persistent', undefined, options)).rejects.toThrow('temporarily unavailable');
    expect(callbacks).toHaveLength(0);
    expect(JSON.parse((await store.read())!).tokens.refresh_token).toBe('retained-refresh');
    unavailable = false;
    await login(endpoint, 'persistent', 'o11:read o11:configure', { ...options, reauth: true });
    expect(exchanges).toBe(1); expect(callbacks).toHaveLength(1);
    expect(JSON.parse((await store.read())!).tokens.refresh_token).toBe('fresh-refresh');
    await Promise.all(callbacks);
  } finally {
    output.mockRestore(); server.stop(true);
    if (previous === undefined) delete process.env.O11_CONFIG_DIR; else process.env.O11_CONFIG_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
