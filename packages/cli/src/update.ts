import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { type ReleaseRequest, boundedBytes, parseCliRelease, type CliRelease } from '@o11/agent-kit/cli-release';
import { version } from './version';
import { updateStatus } from './release-version';
import { installPinned } from './install';

export async function bundleSha256(path = process.argv[1]): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
export async function availableUpdate(server: URL, request: ReleaseRequest = fetch) {
  const response = await request(new URL('/api/agent-docs/cli-install', server), { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Update metadata unavailable (HTTP ${response.status}). Retry later.`);
  const release = parseCliRelease(JSON.parse(new TextDecoder().decode(await boundedBytes(response, 128 * 1024))));
  return { ...release, ...updateStatus(version, await bundleSha256(), release) };
}
export function verifyDownload(bytes: Uint8Array, release: CliRelease) {
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== release.integrity) throw new Error('CLI archive checksum mismatch. Nothing was installed.');
}
export async function managedInstallPath(entry: string, root: string): Promise<boolean> {
  try { return await realpath(entry) === await realpath(join(root, 'install/global/node_modules/@o11/cli/dist/index.js')); }
  catch { return false; }
}
export async function installUpdate(release: CliRelease, request: ReleaseRequest = fetch, staging: Omit<NonNullable<Parameters<typeof installPinned>[1]>, 'fetch'> = {}) {
  const root = process.env.BUN_INSTALL ?? join(homedir(), '.bun');
  const managed = await managedInstallPath(process.argv[1], root);
  const response = await request(release.tarball, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`CLI download failed (HTTP ${response.status}).`);
  const bytes = await boundedBytes(response, 16 * 1024 * 1024);
  verifyDownload(bytes, release);
  if (!managed) {
    // Stage an isolated, verified executable instead of overwriting a checkout or
    // another package manager's installation. Its returned command reuses profiles.
    return installPinned({ package: release.package, version: release.version, artifact: {
      url: release.tarball, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), bundleSha256: release.bundleSha256,
    } }, { ...staging, fetch: Object.assign(async () => new Response(new Uint8Array(bytes)), { preconnect: fetch.preconnect }) });
  }
  // Keep the global manifest pinned to a durable registry version, not a temporary file.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'bun.exe' : 'bun', ['install', '--global', '--ignore-scripts', '--registry', 'https://registry.npmjs.org', `@o11/cli@${release.version}`], { cwd: root, env: { ...process.env, BUN_INSTALL_GLOBAL_DIR: join(root, 'install/global'), BUN_INSTALL_BIN: join(root, 'bin') }, stdio: ['ignore', 'ignore', 'pipe'], shell: false });
    child.stderr.resume();
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('Package update failed. Retry with the original package manager.')));
  });
  const installed = join(root, 'install/global/node_modules/@o11/cli/dist/index.js');
  if (await bundleSha256(installed) !== release.bundleSha256) throw new Error('Installed CLI checksum mismatch. Reinstall the advertised version before using it.');
  return { installed: true, version: release.version, command: ['o11'], profilesPreserved: true };
}
