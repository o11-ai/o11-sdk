import { rm } from 'node:fs/promises';
import { assertPackageOutput } from '../../scripts/public-artifacts';
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });
const result = await Bun.build({ entrypoints: ['./src/index.ts'], outdir: './dist', target: 'browser' });
if (!result.success) throw new AggregateError(result.logs, 'Tracking build failed');
await assertPackageOutput(new URL('./dist/', import.meta.url).pathname, ['index.js']);
