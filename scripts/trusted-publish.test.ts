import { expect, test } from 'bun:test';
import { exchangeCredential, inspectTarball, publisherEnvironment, registrySnapshot, unchangedRegistry, releaseScope, verifyIdentity } from './trusted-publish';

const sha = 'a'.repeat(40);
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o11-ai/o11-sdk', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW_REF: 'o11-ai/o11-sdk/.github/workflows/npm-publish.yml@refs/heads/main', GITHUB_SHA: sha, RUNNER_ENVIRONMENT: 'github-hosted', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/oidc?api-version=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-request-credential' };
const now = Date.now();
const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'npm:registry.npmjs.org', repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, workflow_ref: env.GITHUB_WORKFLOW_REF, sha, sub: 'repo:o11-ai/o11-sdk:environment:npm-publish', runner_environment: 'github-hosted', exp: Math.floor(now / 1000) + 300 };
const jwt = (value = claims) => `header.${Buffer.from(JSON.stringify(value)).toString('base64url')}.signature`;
const json = (value: unknown, status = 200) => Response.json(value, { status });

test('only reviewed packages, exact stable versions and protected main workflow can request publishing', () => {
  expect(releaseScope(env, '@o11/tracking', '0.2.1').directory).toBe('packages/tracking');
  expect(releaseScope(env, '@o11/cli', '0.1.3').directory).toBe('packages/cli');
  for (const change of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'attacker/fork' }, { GITHUB_EVENT_NAME: 'pull_request' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_WORKFLOW_REF: 'another' }, { GITHUB_SHA: '' }, { NPM_CONFIG_TOKEN: 'long-lived' }, { BUN_CONFIG_TOKEN: 'long-lived' }, { NODE_AUTH_TOKEN: 'long-lived' }]) {
    expect(() => releaseScope({ ...env, ...change }, '@o11/tracking', '0.2.1')).toThrow();
  }
  for (const name of ['@o11/agent-kit', 'tracking', '__proto__']) expect(() => releaseScope(env, name, '0.2.1')).toThrow();
  for (const version of ['latest', '0.2.1;cmd', '0.2.1-beta', '']) expect(() => releaseScope(env, '@o11/tracking', version)).toThrow();
});

test('OIDC preflight checks audience, main SHA, environment and expiry; npm verifies signature', () => {
  expect(() => verifyIdentity(jwt(), env, now)).not.toThrow();
  for (const change of [{ aud: 'another' }, { repository: 'fork' }, { ref: 'branch' }, { workflow_ref: 'another' }, { sha: 'b'.repeat(40) }, { sub: 'repo:o11-ai/o11-sdk:ref:refs/heads/main' }, { exp: 0 }, { runner_environment: 'self-hosted' }]) {
    expect(() => verifyIdentity(jwt({ ...claims, ...change }), env, now)).toThrow();
  }
});

test('exchange sends audience and bearer to exact endpoints, no body or persistent token output', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const token = await exchangeCredential(async (url, init) => {
    requests.push({ url, init });
    return requests.length === 1 ? json({ value: jwt() }) : json({ token_type: 'oidc', token: 'synthetic-short-lived', created: new Date(now).toISOString(), expires: new Date(now + 3_600_000).toISOString() }, 201);
  }, env, '@o11/tracking', now);
  expect(token).toBe('synthetic-short-lived');
  expect(new URL(requests[0]!.url).searchParams.get('audience')).toBe('npm:registry.npmjs.org');
  expect(new Headers(requests[0]!.init?.headers).get('Authorization')).toBe(`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`);
  expect(requests[1]!.url).toBe('https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/%40o11%2Ftracking');
  expect(requests[1]!.init?.method).toBe('POST');
  expect(requests[1]!.init?.body).toBeUndefined();
  expect(new Headers(requests[1]!.init?.headers).get('Authorization')).toBe(`Bearer ${jwt()}`);
  expect(requests.every(request => request.init?.redirect === 'error')).toBeTrue();
  expect(publisherEnvironment({ PATH: '/usr/bin', EXTRA_SECRET: 'hidden', ...env }, token, '/tmp/isolated')).toEqual({ PATH: '/usr/bin', HOME: '/tmp/isolated', CI: 'true', NPM_CONFIG_TOKEN: token });
});

test('errors fail closed without credential or response-body disclosure', async () => {
  const secret = 'sensitive-provider-response';
  try { await exchangeCredential(async () => json({ token: secret }, 401), env, '@o11/tracking', now); }
  catch (error) { expect(String(error)).not.toContain(secret); expect(String(error)).not.toContain(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN); }
  for (const url of ['https://attacker.example/oidc', 'http://pipelines.actions.githubusercontent.com/oidc']) {
    let called = false;
    await expect(exchangeCredential(async () => { called = true; return json({}); }, { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: url }, '@o11/tracking', now)).rejects.toThrow();
    expect(called).toBeFalse();
  }
  for (const result of [{ token_type: 'access', token: secret }, { token_type: 'oidc', token: secret, created: new Date(now).toISOString(), expires: new Date(now - 1).toISOString() }]) {
    let calls = 0;
    await expect(exchangeCredential(async () => ++calls === 1 ? json({ value: jwt() }) : json(result, 201), env, '@o11/cli', now)).rejects.toThrow();
  }
});

test('registry lookup refuses existing versions, wrong package identity and server failures', async () => {
  expect(await registrySnapshot(async () => json({ name: '@o11/tracking', versions: { '0.2.0': {} } }), '@o11/tracking', '0.2.1')).toContain('0.2.0');
  await expect(registrySnapshot(async () => json({ name: '@o11/tracking', versions: { '0.2.1': {} } }), '@o11/tracking', '0.2.1')).rejects.toThrow();
  await expect(registrySnapshot(async () => json({ name: 'other', versions: {} }), '@o11/tracking', '0.2.1')).rejects.toThrow();
  await expect(registrySnapshot(async () => json({}, 503), '@o11/tracking', '0.2.1')).rejects.toThrow();
});

test('reviewed built package tarball has exact file boundary and rejects mismatched version', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const temp = await mkdtemp(join(tmpdir(), 'o11-public-artifact-'));
  try {
    for (const [name, version] of [['tracking', '0.2.1'], ['cli', '0.1.3']]) {
      const file = join(temp, `${name}.tgz`);
      const child = Bun.spawn([process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', file], { cwd: resolve(import.meta.dir, '..', 'packages', name!), stdout: 'ignore', stderr: 'ignore' });
      expect(await child.exited).toBe(0);
      const bytes = await readFile(file);
      expect(() => inspectTarball(bytes, `@o11/${name}`, version!)).not.toThrow();
      expect(() => inspectTarball(bytes, `@o11/${name}`, '99.0.0')).toThrow();
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('actual Bun publish uses in-memory token and the prebuilt payload against local mock only', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const temp = await mkdtemp(join(tmpdir(), 'o11-bun-publish-contract-'));
  const credential = 'synthetic-local-publish-token';
  let authorizationMatched = false;
  let payloadName: unknown;
  let putCount = 0;
  let attachment: unknown;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'PUT') {
      putCount++;
      authorizationMatched = request.headers.get('authorization') === `Bearer ${credential}`;
      const payload: unknown = await request.json();
      if (payload && typeof payload === 'object' && 'name' in payload) payloadName = payload.name;
      if (payload && typeof payload === 'object' && '_attachments' in payload && payload._attachments && typeof payload._attachments === 'object') {
        const first: unknown = Object.values(payload._attachments)[0];
        if (first && typeof first === 'object' && 'data' in first) attachment = first.data;
      }
      return json({ ok: true }, 201);
    }
    return json({ error: 'not_found' }, 404);
  } });
  try {
    await Bun.write(join(temp, 'package.json'), JSON.stringify({ name: 'o11-synthetic-publish-contract', version: '0.0.0', files: ['index.js'] }));
    await Bun.write(join(temp, 'index.js'), 'export const synthetic = true;\n');
    const tarball = join(temp, 'contract.tgz');
    const pack = Bun.spawn([process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', tarball], { cwd: temp, stdout: 'ignore', stderr: 'ignore' });
    expect(await pack.exited).toBe(0);
    const publish = Bun.spawn([process.execPath, 'publish', tarball, '--registry', server.url.href, '--access', 'public'], {
      cwd: temp, env: publisherEnvironment(process.env, credential, temp), stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
    });
    expect(await publish.exited).toBe(0);
    expect(authorizationMatched).toBeTrue();
    expect(payloadName).toBe('o11-synthetic-publish-contract');
    expect(putCount).toBe(1);
    expect(attachment).toBe(Buffer.from(await Bun.file(tarball).arrayBuffer()).toString('base64'));
  } finally { server.stop(true); await rm(temp, { recursive: true, force: true }); }
});


test('registry state drift blocks a release even if the chosen version remains absent', async () => {
  const original = JSON.stringify({ name: '@o11/tracking', versions: { '0.2.0': {} }, 'dist-tags': { latest: '0.2.0' } });
  await expect(unchangedRegistry(async () => json(JSON.parse(original)), '@o11/tracking', '0.2.1', original)).resolves.toBeUndefined();
  await expect(unchangedRegistry(async () => json({ name: '@o11/tracking', versions: { '0.2.0': {}, '0.3.0': {} } }), '@o11/tracking', '0.2.1', original)).rejects.toThrow();
});

test('CLI refusal never prints supplied credentials or exceptions', async () => {
  const sensitive = 'synthetic-secret-do-not-log';
  const child = Bun.spawn([process.execPath, new URL('./trusted-publish.ts', import.meta.url).pathname, '@o11/tracking', '0.2.1'], { env: { ...env, NPM_CONFIG_TOKEN: sensitive }, stdout: 'pipe', stderr: 'pipe' });
  const output = await new Response(child.stdout).text() + await new Response(child.stderr).text();
  expect(await child.exited).toBe(1);
  expect(output).not.toContain(sensitive);
  expect(output).not.toContain(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  expect(output).toContain('no credential or response body is logged');
});
