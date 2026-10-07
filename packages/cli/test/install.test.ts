import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installPinned } from '../src/install';
const bytes = Buffer.from('fixture archive; installer boundary mocked'), bundle = Buffer.from('fixture cli entry point');
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const manifest = { package: '@o11/cli', version: '0.2.0', artifact: { url: 'https://example.test/cli.tgz', bytes: bytes.length, sha256: sha(bytes), bundleSha256: sha(bundle) } };
const download: typeof fetch = Object.assign(async () => new Response(bytes), { preconnect: fetch.preconnect });
test('a verified staged installation changes launcher only after identity and execution checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'o11-install-')); let probes = 0;
  try {
    await writeFile(join(root, 'o11.cjs'), 'old-launcher');
    const result = await installPinned(manifest, { root, fetch: download, run: async (command, _args, cwd) => {
      expect(await readFile(join(root, 'o11.cjs'), 'utf8')).toBe('old-launcher');
      if (command === 'bun') { const pkg = join(cwd, 'node_modules/@o11/cli'); await mkdir(join(pkg, 'dist'), { recursive: true }); await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@o11/cli', version: '0.2.0' })); await writeFile(join(pkg, 'dist/index.js'), bundle); }
      else probes++;
    } });
    expect(result.installed).toBe(true); expect(probes).toBe(1); expect(await readFile(result.launcher, 'utf8')).toContain('release-');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('checksum, package-manager and binary mismatch failures retain the previous executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'o11-install-')); let executed = false;
  try {
    await writeFile(join(root, 'o11.cjs'), 'old-launcher');
    await expect(installPinned({ ...manifest, artifact: { ...manifest.artifact, sha256: '0'.repeat(64) } }, { root, fetch: download, run: async () => { executed = true; } })).rejects.toThrow('checksum');
    expect(executed).toBe(false);
    await expect(installPinned(manifest, { root, fetch: download, run: async () => { throw new Error('fixture install failed'); } })).rejects.toThrow('install failed');
    expect(await readFile(join(root, 'o11.cjs'), 'utf8')).toBe('old-launcher');
  } finally { await rm(root, { recursive: true, force: true }); }
});
