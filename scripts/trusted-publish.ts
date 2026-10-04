import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { assertPublicText } from './public-artifacts';

const registry = 'https://registry.npmjs.org';
const repository = 'o11-ai/o11-sdk';
const workflow = `${repository}/.github/workflows/npm-publish.yml@refs/heads/main`;
const audience = 'npm:registry.npmjs.org';
const packages = {
  '@o11/tracking': ['dist/index.js', 'dist/browser.js', 'src/index.ts', 'src/profile.ts', 'src/transport.ts', 'README.md', 'LICENSE'],
  '@o11/cli': ['dist/index.js', 'README.md', 'LICENSE'],
} as const;
type Environment = Record<string, string | undefined>;
type Json = Record<string, unknown>;
type Request = (url: string, init?: RequestInit) => Promise<Response>;
export class PublishError extends Error {}
function refuse(): never { throw new PublishError('Trusted release refused. Check release configuration and registry state.'); }
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse();
  return value as Json;
}
export function releaseScope(env: Environment, name: string, version: string) {
  if (!Object.hasOwn(packages, name) || !/^\d+\.\d+\.\d+$/.test(version)
    || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository
    || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_WORKFLOW_REF !== workflow || env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')
    || env.NPM_CONFIG_TOKEN || env.NODE_AUTH_TOKEN || env.BUN_CONFIG_TOKEN) refuse();
  return { name, version, directory: `packages/${name.slice('@o11/'.length)}` };
}
export function verifyIdentity(token: string, env: Environment, now: number) {
  let claims: Json;
  try { claims = object(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())); }
  catch { refuse(); }
  // npm verifies the signature. These checks reject accidental workflow scope drift before exchange.
  if (claims.iss !== 'https://token.actions.githubusercontent.com' || claims.aud !== audience
    || claims.repository !== repository || claims.ref !== 'refs/heads/main'
    || claims.workflow_ref !== workflow || claims.sha !== env.GITHUB_SHA
    || claims.sub !== `repo:${repository}:environment:npm-publish`
    || claims.runner_environment !== 'github-hosted'
    || typeof claims.exp !== 'number' || claims.exp * 1000 <= now + 30_000) refuse();
}
export function inspectTarball(bytes: Uint8Array, name: string, version: string) {
  if (!Object.hasOwn(packages, name)) refuse();
  const allowed = packages[name as keyof typeof packages];
  const tar = gunzipSync(bytes);
  const found: string[] = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const path = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString().replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString().replace(/\0.*$/, '').trim();
    const size = /^[0-7]+$/.test(sizeText) ? parseInt(sizeText, 8) : NaN;
    if (prefix || !Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length
      || ![0, 48].includes(header[156] ?? -1) || !path.startsWith('package/')) refuse();
    const relative = path.slice(8);
    if (found.includes(relative) || ![...allowed, 'package.json'].includes(relative)) refuse();
    found.push(relative);
    const text = tar.subarray(offset + 512, offset + 512 + size).toString('utf8');
    assertPublicText(text, relative);
    if (relative === 'package.json') {
      const metadata = object(JSON.parse(text));
      if (metadata.name !== name || metadata.version !== version || metadata.private === true) refuse();
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (found.length !== allowed.length + 1) refuse();
}
async function jsonResponse(request: Request, url: string, init?: RequestInit): Promise<Json> {
  const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) refuse();
  return object(await response.json());
}
export async function registrySnapshot(request: Request, name: string, version: string) {
  const metadata = await jsonResponse(request, `${registry}/${encodeURIComponent(name)}`);
  if (metadata.name !== name || object(metadata.versions)[version] !== undefined) refuse();
  return JSON.stringify(metadata);
}
export async function exchangeCredential(request: Request, env: Environment, name: string, now = Date.now()) {
  if (!Object.hasOwn(packages, name)) refuse();
  const requestUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL ?? 'https://invalid.invalid');
  if (requestUrl.protocol !== 'https:' || requestUrl.username || requestUrl.password
    || !requestUrl.hostname.endsWith('.actions.githubusercontent.com')
    || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) refuse();
  requestUrl.searchParams.set('audience', audience);
  const identity = await jsonResponse(request, requestUrl.href, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  if (typeof identity.value !== 'string') refuse();
  verifyIdentity(identity.value, env, now);
  if (!Object.hasOwn(packages, name)) refuse();
  const response = await request(`${registry}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${identity.value}` },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 201) refuse();
  const result = object(await response.json());
  const created = Date.parse(String(result.created));
  const expires = Date.parse(String(result.expires));
  if (result.token_type !== 'oidc' || typeof result.token !== 'string' || !result.token
    || /[\r\n]/.test(result.token) || !Number.isFinite(created) || !Number.isFinite(expires)
    || created > now + 30_000 || expires <= now + 60_000 || expires - created > 3_600_000) refuse();
  return result.token;
}
export function publisherEnvironment(env: Environment, token: string, home: string) {
  // Credentials are passed only to the fixed Bun publisher process, never scripts or disk.
  return { PATH: env.PATH ?? '', HOME: home, CI: 'true', NPM_CONFIG_TOKEN: token };
}
async function command(args: string[], cwd: string, env: Environment = process.env) {
  const child = Bun.spawn(args, { cwd, env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  if (await child.exited !== 0) refuse();
}
export async function unchangedRegistry(request: Request, name: string, version: string, initial: string) {
  if (await registrySnapshot(request, name, version) !== initial) refuse();
}
async function main() {
  const scope = releaseScope(process.env, process.argv[2] ?? '', process.argv[3] ?? '');
  const root = resolve(import.meta.dir, '..');
  const packageRoot = resolve(root, scope.directory);
  const metadata = object(JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')));
  if (metadata.name !== scope.name || metadata.version !== scope.version || metadata.private === true) refuse();
  const initial = await registrySnapshot(fetch, scope.name, scope.version);
  const temporary = await mkdtemp(resolve(tmpdir(), 'o11-publish-'));
  try {
    const tarball = resolve(temporary, 'release.tgz');
    await command([process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', tarball], packageRoot);
    const bytes = await readFile(tarball);
    inspectTarball(bytes, scope.name, scope.version);
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const token = await exchangeCredential(fetch, process.env, scope.name);
    await unchangedRegistry(fetch, scope.name, scope.version, initial);
    await command([process.execPath, 'publish', tarball, '--access', 'public', '--tag', 'latest', '--registry', registry],
      temporary, publisherEnvironment(process.env, token, temporary));
    let confirmed = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await fetch(`${registry}/${encodeURIComponent(scope.name)}/${scope.version}`, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (response.ok) {
        const published = object(await response.json());
        if (published.name !== scope.name || published.version !== scope.version || object(published.dist).integrity !== integrity) refuse();
        confirmed = true;
        break;
      }
      if (response.status !== 404) refuse();
      await Bun.sleep(2_000);
    }
    if (!confirmed) refuse();
    console.log(`Published and registry-confirmed ${scope.name}@${scope.version}.`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (import.meta.main) main().catch(() => {
  console.error('Trusted release failed; no credential or response body is logged.');
  process.exitCode = 1;
});
