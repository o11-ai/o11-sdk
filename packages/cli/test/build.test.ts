import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
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
});
