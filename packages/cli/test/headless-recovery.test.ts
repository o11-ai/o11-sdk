import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Body = Record<string, unknown>;
type Seen = { path: string; method: string; body: Body; authorization: string | null };
type Handler = (request: Seen) => Response | Promise<Response>;
const token = 'fixture-service-token-never-print';
const operationId = '64f193a5-47ab-40fd-acd0-78d1880aa15c';
const secondId = '877015b8-720c-41bd-a323-aea496bde9cf';
let bundle: string;
let buildDirectory: string;
const cleanup: (() => Promise<void>)[] = [];

beforeAll(async () => {
  buildDirectory = await mkdtemp(join(tmpdir(), 'o11-recovery-build-'));
  const result = await Bun.build({ entrypoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))], outdir: buildDirectory, target: 'node', external: ['@modelcontextprotocol/client', '@modelcontextprotocol/server', '@napi-rs/keyring'] });
  if (!result.success) throw new AggregateError(result.logs, 'Cannot build the CLI under test.');
  bundle = result.outputs[0]!.path;
});
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
afterAll(async () => { await rm(buildDirectory, { recursive: true, force: true }); });

async function fixture(runtime: 'node' | 'bun', handler: Handler) {
  const directory = await mkdtemp(join(tmpdir(), 'o11-recovery-'));
  const requests: Seen[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const seen: Seen = { path: new URL(request.url).pathname.replace('/api/agent/v1/', ''), method: request.method, body: request.method === 'POST' ? await request.json() as Body : {}, authorization: request.headers.get('authorization') };
    requests.push(seen);
    return handler(seen);
  } });
  cleanup.push(async () => { server.stop(true); await rm(directory, { recursive: true, force: true }); });
  const spawn = (args: string[], env: Record<string, string | undefined> = {}) => {
    const command = Bun.spawn([runtime, bundle, ...args, '--json'], {
      cwd: directory, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, O11_CONFIG_DIR: join(directory, 'config'), O11_SERVER: server.url.href, O11_TOKEN: token, O11_TOKEN_FILE: undefined, ...env },
    });
    const stdout = new Response(command.stdout).text(), stderr = new Response(command.stderr).text();
    const timer = setTimeout(() => command.kill('SIGKILL'), 8000);
    const result = Promise.all([command.exited, stdout, stderr]).then(([code, out, err]) => ({ code, stdout: out, stderr: err, value: JSON.parse(out || err || '{}') as Body })).finally(() => clearTimeout(timer));
    return { command, result };
  };
  return { directory, requests, spawn, run: (args: string[], env?: Record<string, string | undefined>) => spawn(args, env).result };
}
const descriptor = (mutation: boolean) => Response.json({ result: { mutation, inputSchema: { type: 'object', additionalProperties: true } } });
const completed = () => Response.json({ result: { outcome: 'completed' } });
const failedWrite = () => Response.json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Response lost after dispatch.' }, operation: { id: operationId, state: 'uncertain' } }, { status: 503 });

// These subprocess tests prove transport, local persistence, and exit behavior.
// The controlled HTTP peer does not prove backend authorization or side effects.
for (const runtime of ['node', 'bun'] as const) {
  test(`${runtime}: uncertain writes execute once and expose a receipt that can be read headlessly`, async () => {
    const app = await fixture(runtime, request => request.path.startsWith('operations/') ? Response.json({ result: { id: operationId, state: 'completed' } }) : failedWrite());
    const result = await app.run(['routines', 'archive', '--id', 'routine', '--operation-id', operationId]);
    expect(result.code).toBe(1);
    expect(result.value.error).toMatchObject({ operationId, operation: { state: 'uncertain' }, httpStatus: 503 });
    expect(app.requests).toHaveLength(1);
    const receipt = await app.run(['operations', 'status', '--id', operationId]);
    expect(receipt.code).toBe(0);
    expect(receipt.value.result).toMatchObject({ state: 'completed' });
    expect(app.requests[1]).toMatchObject({ path: `operations/${operationId}`, method: 'GET', authorization: `Bearer ${token}` });
  });

  test(`${runtime}: batch resume skips completed work and retains the uncertain write ID`, async () => {
    let attempts = 0;
    const app = await fixture(runtime, request => request.path.startsWith('commands/') ? descriptor(true) : request.body._operationId === secondId && ++attempts === 1 ? failedWrite() : completed());
    const manifest = join(app.directory, 'batch.json'), journal = join(app.directory, 'batch-journal.json');
    const items = [{ id: 'first', path: 'engagement.routines.archive', input: { id: 'first', _operationId: operationId } }, { id: 'second', path: 'engagement.routines.archive', input: { id: 'second', _operationId: secondId } }];
    await writeFile(manifest, JSON.stringify({ version: 1, items }));
    const args = ['batch', '--input', manifest, '--journal', journal];
    const first = await app.run(args);
    expect(first.code).toBe(2); expect(first.value).toMatchObject({ completed: 1, failed: 1 });
    expect((await app.run(args)).value).toMatchObject({ completed: 2, failed: 0 });
    expect((await app.run(args)).code).toBe(0);
    expect(app.requests.filter(request => request.path.startsWith('execute/')).map(request => request.body._operationId)).toEqual([operationId, secondId, secondId]);
    if (process.platform !== 'win32') expect((await stat(journal)).mode & 0o777).toBe(0o600);
    await writeFile(manifest, JSON.stringify({ version: 1, items: [{ ...items[0], input: { id: 'changed', _operationId: operationId } }] }));
    expect((await app.run(args)).code).toBe(1);
    expect(app.requests.filter(request => request.path.startsWith('execute/'))).toHaveLength(3);
  });

  test(`${runtime}: setup resumes its pending receipt and later applies no duplicate write`, async () => {
    let attempts = 0, ready = false;
    const app = await fixture(runtime, request => {
      if (request.path === 'status') return Response.json({ result: { organizationId: 'organization', workflow: { state: ready ? 'verified' : 'blocked', next: ready ? [] : [{ path: 'engagement.routines.configureMonitoring', available: true, autoApply: true, input: { organizationId: 'organization', id: 'routine' } }] } } });
      if (++attempts === 1) return failedWrite();
      ready = true; return completed();
    });
    const args = ['setup', 'apply', '--routine-id', 'routine', '--organization-id', 'organization', '--journal', join(app.directory, 'setup.json')];
    expect((await app.run(args)).code).toBe(1);
    expect((await app.run(args)).code).toBe(0);
    expect((await app.run(args)).code).toBe(0);
    const writes = app.requests.filter(request => request.path.startsWith('execute/'));
    expect(writes).toHaveLength(2);
    expect(writes[0]!.body._operationId).toBeString();
    expect(writes[1]!.body._operationId).toBe(writes[0]!.body._operationId);
  });

  test(`${runtime}: stale setup state stops instead of repeatedly applying a completed action`, async () => {
    const app = await fixture(runtime, request => request.path === 'status' ? Response.json({ result: { organizationId: 'organization', workflow: { state: 'blocked', next: [{ path: 'engagement.routines.configureMonitoring', available: true, autoApply: true, input: { organizationId: 'organization', id: 'routine' } }] } } }) : completed());
    const args = ['setup', 'apply', '--routine-id', 'routine'];
    const first = await app.run(args);
    expect(first.code).toBe(2); expect(first.value.setup).toMatchObject({ state: 'stalled' });
    expect((await app.run(args)).code).toBe(2);
    expect(app.requests.filter(request => request.path.startsWith('execute/'))).toHaveLength(1);
  });

  test(`${runtime}: deferred setup steps retain a pending journal entry for a later resume`, async () => {
    let deferred = true, ready = false;
    const app = await fixture(runtime, request => {
      if (request.path === 'status') return Response.json({ result: { organizationId: 'organization', workflow: { state: ready ? 'verified' : 'blocked', next: ready ? [] : [{ path: 'engagement.routines.configureMonitoring', available: true, autoApply: true, input: { organizationId: 'organization', id: 'routine' } }] } } });
      if (deferred) { deferred = false; return Response.json({ result: { outcome: 'deferred', retryAt: '2030-01-01T00:00:00Z' } }); }
      ready = true; return completed();
    });
    const journal = join(app.directory, 'deferred.json');
    const args = ['setup', 'apply', '--routine-id', 'routine', '--journal', journal];
    const first = await app.run(args);
    expect(first.code).toBe(2); expect(first.value.setup).toMatchObject({ state: 'blocked' });
    const saved = JSON.parse(await readFile(journal, 'utf8')) as { entries: Record<string, { state: string }> };
    expect(Object.values(saved.entries).map(entry => entry.state)).toEqual(['pending']);
    expect((await app.run(args)).code).toBe(0);
    const writes = app.requests.filter(request => request.path.startsWith('execute/'));
    expect(writes).toHaveLength(2); expect(writes[0]!.body._operationId).toBe(writes[1]!.body._operationId);
  });

  test(`${runtime}: setup keeps refused and unfinished outcomes pending`, async () => {
    for (const response of [{ result: { outcome: 'refused' } }, { result: { outcome: 'not_applied' } }, { result: { state: 'uncertain' } }, { result: { state: 'pending' } }, { result: { saved: true }, operation: { state: 'running' } }]) {
      const app = await fixture(runtime, request => request.path === 'status' ? Response.json({ result: { organizationId: 'organization', workflow: { state: 'blocked', next: [{ path: 'engagement.routines.configureMonitoring', available: true, autoApply: true, input: { organizationId: 'organization', id: 'routine' } }] } } }) : Response.json(response));
      const journal = join(app.directory, 'unfinished.json');
      const result = await app.run(['setup', 'apply', '--routine-id', 'routine', '--journal', journal]);
      expect(result.code).toBe(2); expect(result.value.setup).toMatchObject({ state: 'blocked' });
      const saved = JSON.parse(await readFile(journal, 'utf8')) as { entries: Record<string, { state: string }> };
      expect(Object.values(saved.entries).map(entry => entry.state)).toEqual(['pending']);
      expect(app.requests.filter(request => request.path.startsWith('execute/'))).toHaveLength(1);
    }
  }, 10000);

  test(`${runtime}: interrupted batch recovers its dead lock and the same pending receipt`, async () => {
    if (process.platform === 'win32') return;
    let accepted: (() => void) | undefined, release: (() => void) | undefined, writes = 0;
    const requested = new Promise<void>(resolve => { accepted = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const app = await fixture(runtime, async request => {
      if (request.path.startsWith('commands/')) return descriptor(true);
      if (++writes === 1) { accepted?.(); await blocked; }
      return completed();
    });
    const manifest = join(app.directory, 'crash-batch.json'), journal = join(app.directory, 'crash-journal.json');
    await writeFile(manifest, JSON.stringify({ version: 1, items: [{ id: 'write', path: 'engagement.routines.archive', input: { id: 'routine', _operationId: operationId } }] }));
    const args = ['batch', '--input', manifest, '--journal', journal];
    const pending = app.spawn(args); await requested; pending.command.kill('SIGKILL');
    expect((await pending.result).code).not.toBe(0); release?.();
    const saved = JSON.parse(await readFile(journal, 'utf8')) as { pending: Record<string, { operationId: string }> };
    expect(saved.pending.write!.operationId).toBe(operationId);
    expect((await app.run(args)).code).toBe(0);
    expect(app.requests.filter(request => request.path.startsWith('execute/')).map(request => request.body._operationId)).toEqual([operationId, operationId]);
  });

  test(`${runtime}: concurrent batch processes share one completed journal`, async () => {
    const app = await fixture(runtime, async request => {
      if (request.path.startsWith('commands/')) return descriptor(true);
      await new Promise(resolve => setTimeout(resolve, 150)); return completed();
    });
    const manifest = join(app.directory, 'concurrent-batch.json'), journal = join(app.directory, 'concurrent-journal.json');
    await writeFile(manifest, JSON.stringify({ version: 1, items: [{ id: 'write', path: 'engagement.routines.archive', input: { id: 'routine', _operationId: operationId } }] }));
    const args = ['batch', '--input', manifest, '--journal', journal];
    const results = await Promise.all([app.run(args), app.run(args)]);
    expect(results.map(result => result.code)).toEqual([0, 0]);
    expect(app.requests.filter(request => request.path.startsWith('execute/'))).toHaveLength(1);
  });

  test(`${runtime}: permission errors redact token and file secrets without retrying`, async () => {
    const secret = 'private-password-from-file';
    const app = await fixture(runtime, () => Response.json({ error: { code: 'FORBIDDEN', message: `Denied ${token} ${secret}`, nested: { apiKey: secret, detail: token } } }, { status: 403 }));
    const secretPath = join(app.directory, 'secret'); await writeFile(secretPath, secret, { mode: 0o600 });
    const result = await app.run(['call', 'connectors_update', '--operation-id', operationId, '--set-file', `password=${secretPath}`]);
    expect(result.code).toBe(1); expect(result.value.error).toMatchObject({ code: 'FORBIDDEN', httpStatus: 403 });
    expect(result.stderr).not.toContain(token); expect(result.stderr).not.toContain(secret); expect(result.stdout).toBe('');
    expect(app.requests).toHaveLength(1);
  });

  test(`${runtime}: output reservation rejects existing files before dispatch and writes private results`, async () => {
    const app = await fixture(runtime, () => Response.json({ result: { outcome: 'completed' }, operation: { id: operationId, state: 'completed' } }));
    const output = join(app.directory, 'result.json'); await writeFile(output, 'keep this');
    const args = ['routines', 'archive', '--id', 'routine', '--operation-id', operationId, '--output-file', output];
    expect((await app.run(args)).code).toBe(1); expect(app.requests).toHaveLength(0);
    expect(await readFile(output, 'utf8')).toBe('keep this');
    await rm(output);
    const result = await app.run(args);
    expect(result.code).toBe(0); expect(result.value).toEqual({ saved: output });
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ operation: { id: operationId } });
    if (process.platform !== 'win32') expect((await stat(output)).mode & 0o777).toBe(0o600);
  });

  test(`${runtime}: polling deadline and termination leave remote work running`, async () => {
    let observed: (() => void) | undefined;
    const app = await fixture(runtime, () => { observed?.(); return Response.json({ result: { state: 'pending' } }); });
    const timed = await app.run(['wait', '--id', operationId, '--timeout', '150', '--interval', '20']);
    expect(timed.code).toBe(2); expect(timed.value.state).toBe('timeout');
    if (process.platform !== 'win32') {
      const requested = new Promise<void>(resolve => { observed = resolve; });
      const pending = app.spawn(['wait', '--id', operationId, '--timeout', '5000', '--interval', '20']);
      await requested; pending.command.kill('SIGTERM');
      const cancelled = await pending.result;
      expect(cancelled.code).toBe(130); expect(cancelled.value.state).toBe('cancelled');
    }
    expect(app.requests.every(request => request.path === `operations/${operationId}` && request.method === 'GET')).toBe(true);
  });

  test(`${runtime}: polling refuses mutation descriptors before dispatch`, async () => {
    const app = await fixture(runtime, () => descriptor(true));
    const result = await app.run(['wait', '--path', 'engagement.routines.archive', '--id', 'routine', '--timeout', '150']);
    expect(result.code).toBe(1); expect(result.stderr).toContain('read-only');
    expect(app.requests).toHaveLength(1); expect(app.requests[0]!.path).toStartWith('commands/');
  });

  test(`${runtime}: insecure and symlinked service token files fail before network access`, async () => {
    if (process.platform === 'win32') return;
    const app = await fixture(runtime, completed);
    const file = join(app.directory, 'token'), link = join(app.directory, 'token-link');
    await writeFile(file, token); await chmod(file, 0o644);
    expect((await app.run(['status'], { O11_TOKEN: undefined, O11_TOKEN_FILE: file })).code).toBe(1);
    await chmod(file, 0o600); await symlink(file, link);
    expect((await app.run(['status'], { O11_TOKEN: undefined, O11_TOKEN_FILE: link })).code).toBe(1);
    expect(app.requests).toHaveLength(0);
    expect((await app.run(['status'], { O11_TOKEN: undefined, O11_TOKEN_FILE: file })).code).toBe(0);
    expect(app.requests[0]!.authorization).toBe(`Bearer ${token}`);
  });
}
