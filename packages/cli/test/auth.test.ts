import { expect, test } from 'bun:test';
import { CliAuth, type SecretStore } from '../src/vault';
import { validCallback } from '../src/login';
import { profileName, serverUrl } from '../src/profile';
test('OAuth state is checked and credentials are isolated by issuer', async () => {
  let stored: string | null = null;
  const vault: SecretStore = { read: async () => stored, write: async value => { stored = value; }, clear: async () => { stored = null; } };
  const auth = await new CliAuth('http://127.0.0.1:49191/callback', vault, async () => {}).load();
  const state = auth.state();
  expect(validCallback(new URL(`http://127.0.0.1:49191/callback?code=code&state=${state}`), state)).toBe(true);
  expect(validCallback(new URL('http://127.0.0.1:49191/callback?code=code&state=wrong'), state)).toBe(false);
  expect(validCallback(new URL(`https://evil.test/callback?code=code&state=${state}`), state)).toBe(false);
  await auth.saveClientInformation({ client_id: 'one' }, { issuer: 'https://issuer.example' });
  expect(auth.clientInformation({ issuer: 'https://other.example' })).toBeUndefined();
  await auth.saveTokens({ access_token: 'token', token_type: 'Bearer' });
  expect((await new CliAuth(auth.redirectUrl, vault, async () => {}).load()).tokens()?.access_token).toBe('token');
  await auth.invalidateCredentials('all');
  expect(auth.tokens()).toBeUndefined();
});
test('CLI rejects credentials in endpoints and remote plaintext HTTP', () => {
  expect(() => serverUrl('https://user:password@example.test/mcp')).toThrow();
  expect(() => serverUrl('https://example.test/mcp?token=secret')).toThrow();
  expect(() => serverUrl('http://example.test/mcp')).toThrow();
  expect(serverUrl('http://127.0.0.1:5101/api/mcp').hostname).toBe('127.0.0.1');
  expect(() => profileName.parse('__proto__')).toThrow('Choose a different profile name.');
});
test('refresh responses retain omitted refresh token and scope only within the same issuer', async () => {
  let stored: string | null = null;
  const store: SecretStore = { read: async () => stored, write: async value => { stored = value; }, clear: async () => { stored = null; } };
  const provider = await new CliAuth('http://127.0.0.1:49191/callback', store, async () => {}).load();
  await provider.saveTokens({ access_token: 'old', refresh_token: 'refresh', token_type: 'Bearer', scope: 'o11:read', issuer: 'https://issuer.example' });
  await provider.saveTokens({ access_token: 'new', token_type: 'Bearer', issuer: 'https://issuer.example' });
  expect((await new CliAuth(provider.redirectUrl, store, async () => {}).load()).tokens()).toMatchObject({ access_token: 'new', refresh_token: 'refresh', scope: 'o11:read' });
  await provider.saveTokens({ access_token: 'other', token_type: 'Bearer', issuer: 'https://other.example' });
  expect(provider.tokens()?.refresh_token).toBeUndefined();
  expect(provider.tokens()?.scope).toBeUndefined();
});
test('invalid stored credentials fail with an actionable error without echoing secrets', async () => {
  for (const raw of ['{"clients": secret-value}', '{"clients":null}', '{"clients":[]}', '{"clients":{},"tokens":{"access_token":123,"token_type":"Bearer"}}']) {
    const store: SecretStore = { read: async () => raw, write: async () => {}, clear: async () => {} };
    await expect(new CliAuth('http://127.0.0.1:49191/callback', store, async () => {}).load()).rejects.toThrow('Stored login is invalid. Run o11 logout, then login.');
  }
  expect(() => serverUrl('invalid-secret-value')).toThrow('Use a valid HTTPS MCP URL.');
});
