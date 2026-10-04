import { rm } from 'node:fs/promises';
import { assertPackageOutput } from '../../scripts/public-artifacts';
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });
// Emit portable server ESM without replacing the consumer's environment variables.
const result = await Bun.build({ entrypoints: ['./src/index.ts', './src/browser.ts'], outdir: './dist', target: 'node', env: 'disable' });
if (!result.success) throw new AggregateError(result.logs, 'Tracking build failed');
await assertPackageOutput(new URL('./dist/', import.meta.url).pathname, ['index.js', 'browser.js']);
