import { expect, test } from 'bun:test';
import { CliAuth, type SecretStore } from '../src/vault';
import { validCallback } from '../src/login';
import { serverUrl } from '../src/profile';
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
});
