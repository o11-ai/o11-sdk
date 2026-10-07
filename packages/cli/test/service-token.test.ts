import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serviceToken } from '../src/service-token';
test('service token files are private, bounded, unambiguous, and never follow symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-service-token-')), path = join(dir, 'token');
  const old = { token: process.env.O11_TOKEN, file: process.env.O11_TOKEN_FILE };
  delete process.env.O11_TOKEN; process.env.O11_TOKEN_FILE = path;
  try {
    await writeFile(path, 'a-private-token\n', { mode: 0o600 });
    expect(await serviceToken()).toBe('a-private-token');
    process.env.O11_TOKEN = 'different'; await expect(serviceToken()).rejects.toThrow('only one'); delete process.env.O11_TOKEN;
    await chmod(path, 0o644); await expect(serviceToken()).rejects.toThrow('private regular file'); await chmod(path, 0o600);
    const link = join(dir, 'link'); await symlink(path, link); process.env.O11_TOKEN_FILE = link; await expect(serviceToken()).rejects.toThrow(); process.env.O11_TOKEN_FILE = path;
    await writeFile(path, 'x'.repeat(65537)); await expect(serviceToken()).rejects.toThrow('64 KiB');
  } finally { for (const [key, value] of [['O11_TOKEN', old.token], ['O11_TOKEN_FILE', old.file]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(dir, { recursive: true, force: true }); }
});
