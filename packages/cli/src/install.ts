import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { configRoot } from './profile';

export const installManifest = z.object({ package: z.literal('@o11/cli'), version: z.string().regex(/^[0-9][0-9A-Za-z.+-]{0,100}$/),
  artifact: z.object({ url: z.url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), bundleSha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(32 * 1024 * 1024) }),
});
type Run = (command: string, args: string[], cwd: string) => Promise<void>;
const run: Run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: 'ignore', timeout: 120_000, windowsHide: true });
  child.once('error', () => reject(new Error('The package manager could not start. Install Bun and retry.')));
  child.once('exit', code => code === 0 ? resolve() : reject(new Error('Staged installation failed. The existing launcher was not changed.')));
});
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Stage, verify and probe before replacing a launcher. Auth profiles are never touched. */
export async function installPinned(raw: unknown, options: { root?: string; fetch?: typeof fetch; run?: Run } = {}) {
  const parsed = installManifest.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid pinned installation manifest. Require @o11/cli, HTTPS artifact URL, exact version, size, and archive/bundle SHA-256.');
  const manifest = parsed.data, root = resolve(options.root ?? join(configRoot(), 'installation'));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stage = await mkdtemp(join(root, '.stage-'));
  let installed = false;
  try {
    const response = await (options.fetch ?? fetch)(manifest.artifact.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error('Pinned artifact download failed.');
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > manifest.artifact.bytes) throw new Error('Artifact exceeds its pinned size.'); parts.push(value); }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(parts);
    if (size !== manifest.artifact.bytes || digest(bytes) !== manifest.artifact.sha256) throw new Error('Artifact checksum or size mismatch. The current installation was not changed.');
    const archive = join(stage, 'verified.tgz'); await writeFile(archive, bytes, { mode: 0o600 });
    await writeFile(join(stage, 'package.json'), JSON.stringify({ private: true, dependencies: { '@o11/cli': './verified.tgz' } }), { mode: 0o600 });
    const execute = options.run ?? run;
    // Lifecycle scripts are disabled. The checksum-verified package and its declared dependencies are installed in isolation.
    await execute('bun', ['install', '--ignore-scripts'], stage);
    const executable = join(stage, 'node_modules', '@o11', 'cli', 'dist', 'index.js');
    const info: unknown = JSON.parse(await readFile(join(stage, 'node_modules', '@o11', 'cli', 'package.json'), 'utf8'));
    if (!z.object({ name: z.literal('@o11/cli'), version: z.literal(manifest.version) }).safeParse(info).success || digest(await readFile(executable)) !== manifest.artifact.bundleSha256) throw new Error('Installed package identity mismatch. The current installation was not changed.');
    await execute(process.execPath, [executable, '--version'], stage);
    const release = join(root, `release-${manifest.artifact.sha256}-${crypto.randomUUID()}`);
    await rename(stage, release);
    const binary = join(release, 'node_modules', '@o11', 'cli', 'dist', 'index.js');
    const launcher = join(root, 'o11.cjs'), temporary = `${launcher}.${crypto.randomUUID()}.tmp`;
    // The JSON string is JavaScript data, never interpolated into shell code. Node and Bun both execute this launcher.
    await writeFile(temporary, `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(binary).href)}).catch(() => { process.stderr.write('Installed CLI could not start.\\n'); process.exitCode = 1; });\n`, { mode: 0o700 });
    await rename(temporary, launcher); installed = true;
    return { installed: true, version: manifest.version, sha256: manifest.artifact.sha256, bundleSha256: manifest.artifact.bundleSha256,
      launcher, command: ['node', launcher], profilesPreserved: true, previousReleasesRetained: true };
  } finally { if (!installed) await rm(stage, { recursive: true, force: true }); }
}
