import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundedBytes, parseCliRelease, registryCliRelease } from '@o11/agent-kit/cli-release';
import { verifyDownload, managedInstallPath, installUpdate } from '../src/update';
import { compareReleaseVersions, updateStatus } from '../src/release-version';
const bytes = Buffer.from('test archive');
const release = { package: '@o11/cli' as const, version: '1.2.3', tarball: 'https://registry.npmjs.org/@o11/cli/-/cli-1.2.3.tgz', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, bundleSha256: 'a'.repeat(64) };
test('older metadata never proposes a downgrade, while newer and same-version repairs remain recoverable', () => {
  expect(updateStatus('1.2.4', 'b'.repeat(64), release)).toMatchObject({ updateAvailable: false, reason: 'server_release_older' });
  expect(updateStatus('1.2.2', 'b'.repeat(64), release)).toMatchObject({ updateAvailable: true, reason: 'newer_release' });
  expect(updateStatus('1.2.3', 'b'.repeat(64), release)).toMatchObject({ updateAvailable: true, reason: 'bundle_repair' });
  expect(updateStatus('1.2.3', release.bundleSha256, release)).toMatchObject({ updateAvailable: false, reason: 'current' });
  for (const [older, newer] of [['0.2.9', '0.2.10'], ['1.0.0-beta.2', '1.0.0-beta.10'], ['1.0.0-beta', '1.0.0']]) expect(compareReleaseVersions(older!, newer!)).toBeLessThan(0);
  expect(compareReleaseVersions('1.0.0+one', '1.0.0+two')).toBe(0);
});
test('update metadata rejects alternate artifacts and malformed checksums', () => {
  expect(parseCliRelease(release)).toEqual(release);
  for (const patch of [{ tarball: 'https://evil.example/cli.tgz' }, { version: '1.2.3;echo bad' }, { integrity: 'sha512-abc' }, { bundleSha256: '' }, { package: '@other/cli' }]) expect(() => parseCliRelease({ ...release, ...patch })).toThrow();
  expect(() => verifyDownload(bytes, release)).not.toThrow();
  expect(() => verifyDownload(Buffer.from('changed'), release)).toThrow('checksum');
});
test('registry lookup verifies package identity and fails closed on unpublished version', async () => {
  const response = { name: '@o11/cli', version: release.version, dist: { tarball: release.tarball, integrity: release.integrity }, o11Release: { bundleSha256: release.bundleSha256 } };
  expect(await registryCliRelease(release.version, (async () => Response.json(response)))).toEqual(release);
  await expect(registryCliRelease(release.version, (async () => new Response('', { status: 404 })))).rejects.toThrow('unavailable');
  await expect(registryCliRelease(release.version, (async () => Response.json({ ...response, name: 'other' })))).rejects.toThrow('wrong');
});
test('updater only owns the resolved Bun global executable, including bin symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cli-update-test-'));
  try {
    const dir = join(root, 'install/global/node_modules/@o11/cli/dist');
    await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'index.js'), 'cli');
    await symlink(join(dir, 'index.js'), join(root, 'o11'));
    expect(await managedInstallPath(join(root, 'o11'), root)).toBe(true);
    await writeFile(join(root, 'another.js'), 'cli');
    expect(await managedInstallPath(join(root, 'another.js'), root)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release responses are bounded before archive parsing or installation', async () => {
  await expect(boundedBytes(new Response('12345'), 4)).rejects.toThrow('size limit');
  expect(await boundedBytes(new Response('1234'), 4)).toEqual(new TextEncoder().encode('1234'));
});

test('an unmanaged CLI recovers through a staged verified command while retaining its previous launcher', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cli-update-stage-'));
  const bundle = Buffer.from('verified fixture executable');
  const stagedRelease = { ...release, bundleSha256: createHash('sha256').update(bundle).digest('hex') };
  const launcher = join(root, 'o11.cjs');
  try {
    await writeFile(launcher, 'previous-launcher');
    const result = await installUpdate(stagedRelease, async () => new Response(bytes), { root, run: async (command, _args, cwd) => {
      expect(await readFile(launcher, 'utf8')).toBe('previous-launcher');
      if (command === 'bun') {
        const pkg = join(cwd, 'node_modules/@o11/cli');
        await mkdir(join(pkg, 'dist'), { recursive: true });
        await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: release.package, version: release.version }));
        await writeFile(join(pkg, 'dist/index.js'), bundle);
      }
    } });
    expect(result.command).toEqual(['node', launcher]);
    expect(result.profilesPreserved).toBe(true);
    const updated = await readFile(launcher, 'utf8');
    await expect(installUpdate(stagedRelease, async () => new Response('corrupt'), { root })).rejects.toThrow('checksum');
    expect(await readFile(launcher, 'utf8')).toBe(updated);
  } finally { await rm(root, { recursive: true, force: true }); }
});
