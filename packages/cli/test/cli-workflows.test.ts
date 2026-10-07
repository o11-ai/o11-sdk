import { beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const executable = new URL('../dist/index.js', import.meta.url).pathname;
beforeAll(() => { const result = Bun.spawnSync(['bun', 'build.ts'], { cwd: new URL('../', import.meta.url).pathname }); expect(result.exitCode).toBe(0); });
async function run(args: string[], env: Record<string, string>, runtime = 'bun') {
  const process = Bun.spawn([runtime, executable, ...args], { env: { ...Bun.env, O11_TOKEN_FILE: '', ...env }, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  return { out, err, code, result: out ? JSON.parse(out) as Record<string, unknown> : undefined };
}
test('actual CLI forwards status/setup context, docs search, private output and failing checks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-cli-workflows-'));
  const requests: { path: string; body: unknown }[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url); requests.push({ path: url.pathname + url.search, body: request.method === 'POST' ? await request.json() : null });
    if (url.pathname.endsWith('/status')) return Response.json({ result: { organizationId: 'org', readiness: {}, workflow: { state: 'blocked', blockers: [{ message: 'worker unavailable' }] } } });
    return Response.json({ result: { markdown: 'matching documentation' } });
  } });
  const env = { O11_CONFIG_DIR: dir, O11_SERVER: `http://127.0.0.1:${server.port}`, O11_TOKEN: 'test-token' };
  try {
    expect((await run(['status', '--organization-id', 'org', '--routine-id', 'routine'], env)).code).toBe(0);
    expect(requests[0]?.body).toEqual({ organizationId: 'org', routineId: 'routine' });
    expect((await run(['call', 'o11_setup', '--organization-id', 'org', '--routine-id', 'routine', '--check'], env)).code).toBe(2);
    const output = join(dir, 'status.json');
    const saved = await run(['status', '--output-file', output], env);
    expect(saved.result).toEqual({ saved: output }); expect(saved.out).not.toContain('worker unavailable'); expect(await readFile(output, 'utf8')).toContain('worker unavailable');
    expect((await run(['call', 'o11_docs', '--set', 'query="recording evidence"'], env)).code).toBe(0);
    expect(requests.at(-1)?.path).toBe('/api/agent/v1/docs?search=recording+evidence');
    const count = requests.length;
    expect((await run(['status', '--set', 'ignored=true'], env)).code).toBe(1); expect(requests).toHaveLength(count);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
test('the built CLI runs verified health requests under Node and rejects unknown success outcomes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-cli-node-')); let recognized = true;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return Response.json({ result: recognized ? { organizationId: 'org', workflow: { state: 'verified' } } : { saved: true } }); } });
  const env = { O11_CONFIG_DIR: dir, O11_SERVER: `http://127.0.0.1:${server.port}`, O11_TOKEN: 'test-token' };
  try {
    expect((await run(['check', '--routine-id', 'routine'], env, 'node')).code).toBe(0);
    recognized = false;
    const checked = await run(['call', 'test_probe', '--check'], env, 'node'); expect(checked.code).toBe(2); expect(checked.out).toContain('No verification outcome');
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
test('actual CLI selects profiles and refuses workspace mismatch before remote dispatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-cli-profiles-'));
  const env = { O11_CONFIG_DIR: dir, O11_SERVER: '', O11_TOKEN: '' };
  await writeFile(join(dir, 'profiles.json'), JSON.stringify({ demo: { server: 'https://example.test/api/mcp', credentialStore: 'file' } }), { mode: 0o600 });
  try {
    expect((await run(['profiles', 'select', 'demo'], env)).result).toEqual({ selected: 'demo' });
    expect((await run(['profiles', 'pin', '--organization-id', 'org'], env)).code).toBe(0);
    const inspect = await run(['profiles', 'inspect'], env); expect(inspect.result?.name).toBe('demo'); expect(inspect.result?.pins).toEqual({ organizationId: 'org' });
    const mismatch = await run(['status', '--organization-id', 'wrong'], env); expect(mismatch.code).toBe(1); expect(mismatch.err).toContain('Context mismatch');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('actual CLI reads private secret references and rejects permissive secret files locally', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-cli-secret-')); const secret = join(dir, 'secret');
  await writeFile(secret, 'secret-value', { mode: 0o600 }); let received: unknown;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return Response.json({ result: { mutation: true, inputSchema: { type: 'object', properties: { apiKey: { type: 'string' } } } } });
    received = await request.json(); return Response.json({ result: { saved: true } });
  } });
  const env = { O11_CONFIG_DIR: dir, O11_SERVER: `http://127.0.0.1:${server.port}`, O11_TOKEN: 'test-token' };
  try {
    const result = await run(['call', 'connector_save', '--set-file', `apiKey=${secret}`], env);
    expect(result.code).toBe(0); expect(received).toEqual({ apiKey: 'secret-value' }); expect(result.out + result.err).not.toContain('secret-value');
    await chmod(secret, 0o644);
    const denied = await run(['call', 'connector_save', '--set-file', `apiKey=${secret}`], env); expect(denied.code).toBe(1); expect(denied.err).toContain('private regular file');
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
test('packaged offline completion reuses allowed discovery without credentials or network', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-cli-completion-')); let calls = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { calls++; return Response.json({ server: { schemaVersion: 'v1' }, access: { fingerprint: 'read' }, result: [{ command: 'routines validate-signal', available: true }, { command: 'routines forbidden-action', available: false }] }); } });
  const env = { O11_CONFIG_DIR: dir, O11_SERVER: `http://127.0.0.1:${server.port}`, O11_TOKEN: 'test-token' };
  try {
    expect((await run(['commands', '--all'], env)).code).toBe(0);
    server.stop(true);
    const offline = await run(['completion', 'bash'], { ...env, O11_TOKEN: '', O11_TOKEN_FILE: join(dir, 'missing-token') });
    expect(offline.code).toBe(0); expect(offline.out).toContain('validate-signal'); expect(offline.out).not.toContain('forbidden-action'); expect(calls).toBe(1);
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});

test('Node and Bun execute advertised schema flags and reject invalid inputs before dispatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-cli-schema-')); const executed: unknown[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return Response.json({ result: { mutation: false, inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['events', 'properties'] } } } } });
    executed.push(await request.json()); return Response.json({ result: { resources: [] } });
  } });
  const env = { O11_CONFIG_DIR: dir, O11_SERVER: server.url.href, O11_TOKEN: 'test-token' };
  try {
    for (const runtime of ['node', 'bun']) {
      expect((await run(['signals', 'resources', '--source-id', 'source', '--kind', 'events'], env, runtime)).code).toBe(0);
      expect(executed.at(-1)).toEqual({ sourceId: 'source', kind: 'events' });
      const count = executed.length;
      expect((await run(['signals', 'resources', '--kind', 'invalid'], env, runtime)).code).toBe(1);
      expect((await run(['signals', 'resources', '--typo', 'events'], env, runtime)).code).toBe(1);
      expect(executed).toHaveLength(count);
    }
  } finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
});
