import { fileURLToPath } from 'node:url';
import { rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { assertPackageOutput } from '../../scripts/public-artifacts';
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });
// Emit portable server ESM without replacing the consumer's environment variables.
const result = await Bun.build({ entrypoints: ['./src/index.ts', './src/browser.ts'], outdir: './dist', target: 'node', env: 'disable' });
if (!result.success) throw new AggregateError(result.logs, 'Tracking build failed');
await assertPackageOutput(fileURLToPath(new URL('./dist/', import.meta.url)), ['index.js', 'browser.js']);
const replay = await Bun.build({ entrypoints: ['./src/replay.ts'], outdir: './dist', target: 'browser', splitting: true, minify: true, env: 'disable' });
if (!replay.success) throw new AggregateError(replay.logs, 'Replay build failed');

// rrweb embeds a worker with a dangling source-map directive. Do not ship maps
// or private build paths, including inside the worker's source string.
const output = new URL('./dist/', import.meta.url);
const files = await readdir(output);
for (const file of files) {
  const path = new URL(file, output);
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/^\/\/# sourceMappingURL[=][^\r\n]*$/gm, ''));
}
await assertPackageOutput(fileURLToPath(output), files);
