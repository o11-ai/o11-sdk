import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLoginCredentials } from '../src/login-credentials';
import { CliAuth, credentialStore, type SecretStore } from '../src/vault';
import { login } from '../src/login';

test('failed consent or workspace setup retains the previous login, including its refresh grant', async () => {
  const original = JSON.stringify({ clients: {}, tokens: { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'Bearer' } });
  let saved = original;
  let writes = 0;
  const store: SecretStore = { read: async () => saved, write: async value => { writes++; saved = value; }, clear: async () => { saved = ''; } };
  for (const receivedTokens of [false, true]) {
    await expect(withLoginCredentials(store, async pending => {
      const provider = await new CliAuth('http://127.0.0.1:49191/callback', pending, async () => {}).load();
      await provider.invalidateCredentials('tokens');
      expect(provider.tokens()).toBeUndefined();
      expect(saved).toBe(original);
      if (receivedTokens) await provider.saveTokens({ access_token: 'pending-access', refresh_token: 'pending-refresh', token_type: 'Bearer' });
      throw new Error(receivedTokens ? 'Workspace setup failed' : 'Consent declined');
    })).rejects.toThrow();
    expect(saved).toBe(original);
    expect(writes).toBe(0);
  }
  await withLoginCredentials(store, async pending => {
    const provider = await new CliAuth('http://127.0.0.1:49191/callback', pending, async () => {}).load();
    await provider.invalidateCredentials('tokens');
    await provider.saveTokens({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer' });
    expect(saved).toBe(original);
  });
  expect(writes).toBe(1);
  expect(JSON.parse(saved).tokens.refresh_token).toBe('new-refresh');
});

test('an occupied callback port cannot erase an existing login', async () => {
  const root = await mkdtemp(join(tmpdir(), 'o11-login-port-'));
  const previous = process.env.O11_CONFIG_DIR;
  process.env.O11_CONFIG_DIR = root;
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(49191, '127.0.0.1', resolve));
  try {
    const server = new URL('https://issuer.example/mcp');
    const store = await credentialStore('port-test', server, 'file');
    const original = JSON.stringify({ clients: {}, tokens: { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'Bearer' } });
    await store.write(original);
    await expect(login(server, 'port-test', undefined, { credentialStore: 'file', noBrowser: true })).rejects.toThrow();
    expect(await store.read()).toBe(original);
    expect(await store.exclusive!(async () => true)).toBeTrue();
  } finally {
    await new Promise<void>(resolve => listener.close(() => resolve()));
    if (previous === undefined) delete process.env.O11_CONFIG_DIR; else process.env.O11_CONFIG_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
