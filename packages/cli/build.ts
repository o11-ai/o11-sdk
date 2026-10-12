import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { assertPackageOutput } from '../../scripts/public-artifacts';
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });
// Bundle the private documentation workspace while retaining public runtime
// dependencies as imports. Credential storage needs no native Node addon.
const cli = await Bun.build({ entrypoints: ['./src/index.ts'], outdir: './dist', target: 'node', external: ['@modelcontextprotocol/client', '@modelcontextprotocol/server', 'zod'] });
if (!cli.success) throw new AggregateError(cli.logs, 'CLI build failed');
await assertPackageOutput(fileURLToPath(new URL('./dist/', import.meta.url)), ['index.js']);
