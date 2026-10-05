import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdtemp, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore } from '../src/file-store';
import { loadCredentialMode, saveServer } from '../src/profile';
import { CliAuth } from '../src/vault';

let directory: string | undefined;
const previous = process.env.O11_CONFIG_DIR;
afterEach(async () => {
  if (previous === undefined) delete process.env.O11_CONFIG_DIR; else process.env.O11_CONFIG_DIR = previous;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});
async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'o11-credentials-'));
  process.env.O11_CONFIG_DIR = directory;
  return new URL('https://o11.example/api/mcp');
}
test('explicit file credentials persist OAuth refresh tokens with private permissions and profile/server isolation', async () => {
  const server = await setup();
  const store = await fileStore('default', server);
  const auth = await new CliAuth('http://127.0.0.1:49191/callback', store, async () => {}).load();
  await auth.saveTokens({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer' });
  expect((await new CliAuth(auth.redirectUrl, store, async () => {}).load()).tokens()?.refresh_token).toBe('test-refresh');
  expect(await (await fileStore('other', server)).read()).toBeNull();
  expect(await (await fileStore('default', new URL('https://other.example/api/mcp'))).read()).toBeNull();
  const root = join(directory!, 'credentials');
  expect((await stat(root)).mode & 0o777).toBe(0o700);
  const files = await readdir(root);
  expect(files).toHaveLength(1);
  expect((await stat(join(root, files[0]))).mode & 0o777).toBe(0o600);
  await auth.saveTokens({ access_token: 'renewed', refresh_token: 'renewed-refresh', token_type: 'Bearer' });
  expect((await readdir(root))).toHaveLength(1);
  await store.clear(); expect(await store.read()).toBeNull();
});
test('file credential mode is remembered only for the selected server and never silently selected', async () => {
  const server = await setup();
  expect(await loadCredentialMode('default', server)).toBe('keyring');
  await saveServer('default', server, 'file');
  expect(await loadCredentialMode('default', server)).toBe('file');
  expect(await loadCredentialMode('default', new URL('https://other.example/api/mcp'))).toBe('keyring');
  expect(await loadCredentialMode('default', server, 'keyring')).toBe('keyring');
  await expect(loadCredentialMode('default', server, 'unknown')).rejects.toThrow();
});
test('file credentials reject public permissions and symbolic links without exposing their contents', async () => {
  const server = await setup(); const store = await fileStore('default', server);
  await store.write('test-only-credential');
  const root = join(directory!, 'credentials'), path = join(root, (await readdir(root))[0]);
  await chmod(path, 0o644); await expect(store.read()).rejects.toThrow('private'); await expect(store.write('replacement')).rejects.toThrow('private');
  await chmod(path, 0o600); await rm(path); await symlink(join(directory!, 'profiles.json'), path);
  await expect(store.read()).rejects.toThrow('symbolic'); await expect(store.write('replacement')).rejects.toThrow('symbolic');
  await rm(path); await chmod(root, 0o755); await expect(store.read()).rejects.toThrow('private');
});
