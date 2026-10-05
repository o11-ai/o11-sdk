import { expect, test } from 'bun:test';
import { auth } from '@modelcontextprotocol/client';
import { CliAuth } from '../src/vault';
test('explicit login requests configuration scopes despite a read-only resource default', async () => {
  const issuer = 'https://auth.example.test', server = 'https://api.example.test/api/mcp';
  const scopes = 'o11:read o11:configure o11:credentials o11:publish';
  let authorization: URL | undefined;
  const provider = new CliAuth('http://127.0.0.1:49191/callback', { read: async () => null, write: async () => {}, clear: async () => {} }, async url => { authorization = url; }, scopes);
  const response = await auth(provider, { serverUrl: new URL(server), scope: scopes, fetchFn: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.includes('oauth-protected-resource')) return Response.json({ resource: server, authorization_servers: [issuer], scopes_supported: ['o11:read'] });
    if (url.pathname.includes('oauth-authorization-server')) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'] });
    if (url.pathname === '/register') {
      const data: unknown = JSON.parse(String(init?.body));
      expect(data).toMatchObject({ scope: scopes });
      return Response.json({ client_id: 'test-client', redirect_uris: [provider.redirectUrl], token_endpoint_auth_method: 'none' });
    }
    return new Response(null, { status: 404 });
  } });
  expect(response).toBe('REDIRECT');
  expect(authorization?.searchParams.get('scope')?.split(' ')).toEqual(expect.arrayContaining(scopes.split(' ')));
});
