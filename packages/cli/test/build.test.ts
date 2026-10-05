import { expect, test } from 'bun:test';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('a clean CLI build removes stale artifacts and leaves a runnable offline documentation command', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
  await writeFile(new URL('../dist/internal.txt', import.meta.url), 'unreviewed artifact');
  const built = Bun.spawnSync(['bun', 'build.ts'], { cwd });
  expect(built.exitCode).toBe(0);
  expect(await Bun.file(new URL('../dist/internal.txt', import.meta.url)).exists()).toBe(false);
  expect(await Bun.file(new URL('../dist/index.js', import.meta.url)).exists()).toBe(true);
  const command = Bun.spawnSync(['bun', 'dist/index.js', 'docs', 'setup'], { cwd });
  expect(command.exitCode).toBe(0);
  expect(JSON.parse(command.stdout.toString())).toMatchObject({ id: 'setup', title: 'Set up with your agent' });
  const node = Bun.spawnSync(['node', 'dist/index.js', '--version'], { cwd });
  const manifest: { version: string } = await Bun.file(new URL('../package.json', import.meta.url)).json();
  expect(node.exitCode).toBe(0);
  expect(JSON.parse(node.stdout.toString())).toEqual({ version: manifest.version });
  const nodeDocs = Bun.spawnSync(['node', 'dist/index.js', 'docs', 'setup'], { cwd });
  expect(nodeDocs.exitCode).toBe(0);
  expect(JSON.parse(nodeDocs.stdout.toString())).toMatchObject({ id: 'setup' });
  const directory = await mkdtemp(join(tmpdir(), 'o11-cli-package-'));
  try {
    const packed = Bun.spawnSync(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', join(directory, 'cli.tgz')], { cwd });
    expect(packed.exitCode).toBe(0);
    const contents = Bun.spawnSync(['tar', '-tzf', join(directory, 'cli.tgz')]);
    expect(contents.exitCode).toBe(0);
    expect(contents.stdout.toString().trim().split('\n').sort()).toEqual(['package/LICENSE', 'package/README.md', 'package/dist/index.js', 'package/package.json']);
    const extracted = Bun.spawnSync(['tar', '-xzf', join(directory, 'cli.tgz'), '-C', directory]);
    expect(extracted.exitCode).toBe(0);
    const packagedManifest = await Bun.file(join(directory, 'package/package.json')).json();
    expect(packagedManifest.bin.o11).toBe('./dist/index.js');
    expect(packagedManifest.dependencies['@napi-rs/keyring']).toBeDefined();
    expect(await Bun.file(join(directory, 'package/dist/index.js')).text()).toContain('credential-store');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
