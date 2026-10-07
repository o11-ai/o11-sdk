import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Blackbox tests: only the built executable talks to this controlled HTTP service.
// The fixture checks transport contracts; it does not simulate detector accuracy.
const executable = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const runtimes = ['node', 'bun'];
type Input = Record<string, unknown>;
type Descriptor = { path: string; command: string; mutation: boolean; available: boolean; scope?: string | null };
const baseDescriptors: Descriptor[] = [
  ...['create', 'get', 'patch', 'archive', 'restore'].map(action => ({ path: `engagement.routines.${action}`, command: `routines ${action}`, mutation: action !== 'get', available: true })),
  ...['analyzeSelectedOnly', 'selectedProgress', 'pauseSelectedOnly', 'resumeSelectedOnly'].map((action, i) => ({ path: `research.${action}`, command: ['research analyze-selected-only', 'research selected-progress', 'research pause-selected-only', 'research resume-selected-only'][i]!, mutation: i !== 1, available: true })),
  { path: 'analytics.startOAuth', command: 'analytics start-oauth', mutation: true, available: false },
  { path: 'engagement.knowledge.mcpOAuthStart', command: 'knowledge mcp-oauth-start', mutation: true, available: false },
];
const failure = (code: string, status = 422, extra: Input = {}) => Response.json({ error: { code, message: code }, ...extra }, { status });
const uuid = () => crypto.randomUUID();

async function fixture(descriptors = baseDescriptors) {
  const directory = await mkdtemp(join(existsSync('/dev/shm') ? '/dev/shm' : tmpdir(), 'o11-headless-contract-'));
  const requests: { path: string; body: Input; method: string }[] = [];
  const receipts = new Map<string, { signature: string; response: Input }>();
  let routine = { id: 'routine', name: '', revision: 0, archived: false };
  let phase = 'queued', runId = '', polls = 0, statusIndex = 0, lostResponse = false;
  const state = { status: ['scheduled'], failAfterCommit: false, retryReads: 0, discoveryOnly: false };
  const descriptor = (item: Descriptor) => ({ ...item, inputSchema: { type: 'object', properties: { organizationId: { type: 'string' }, runId: { type: 'string' }, sessionIds: { type: 'array', items: { type: 'string' } } }, required: ['organizationId'], additionalProperties: true } });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url), path = decodeURIComponent(url.pathname.slice('/api/agent/v1/'.length));
    const body = request.method === 'POST' ? await request.json() as Input : {};
    requests.push({ path, body, method: request.method });
    if (request.headers.get('authorization') !== 'Bearer fixture-only-token') return failure('UNAUTHORIZED', 401);
    if (path === 'commands') return Response.json({ server: { schemaVersion: 'fixture-v1' }, access: { fingerprint: 'fixture' }, result: descriptors.map(descriptor) });
    if (path.startsWith('commands/')) {
      const item = descriptors.find(item => item.path === path.slice(9));
      if (!item) return failure('NOT_FOUND', 404);
      return item.available ? Response.json({ result: descriptor(item) }) : failure('HUMAN_ACTION_REQUIRED', 403);
    }
    if (path === 'status') {
      if (state.retryReads-- > 0) return new Response(JSON.stringify({ error: { code: 'TEMPORARY' } }), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
      return Response.json({ result: { organizationId: 'org', workflow: { state: state.status[Math.min(statusIndex++, state.status.length - 1)], checkedAt: new Date().toISOString() } } });
    }
    if (path.startsWith('operations/')) return Response.json({ result: receipts.get(path.slice(11))?.response.operation ?? null });
    const operation = path.slice(8), item = descriptors.find(item => item.path === operation);
    if (!path.startsWith('execute/') || !item) return failure('NOT_FOUND', 404);
    if (!item.available) return failure('HUMAN_ACTION_REQUIRED', 403);
    if (body.organizationId !== 'org') return failure('FORBIDDEN', 403);
    const operationId = body._operationId;
    if (item.mutation && (typeof operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(operationId))) return failure('OPERATION_ID_REQUIRED');
    const signature = JSON.stringify({ operation, body });
    if (typeof operationId === 'string' && receipts.has(operationId)) {
      const previous = receipts.get(operationId)!;
      return previous.signature === signature ? Response.json(previous.response) : failure('CONFLICT');
    }
    let result: Input = { receivedPath: operation };
    if (!state.discoveryOnly && operation.startsWith('engagement.routines.')) {
      const action = operation.split('.').at(-1);
      if (action === 'create') {
        if (routine.revision) return failure('ALREADY_EXISTS');
        routine = { ...routine, name: String(body.name), revision: 1 };
      } else if (body.id !== routine.id) return failure('NOT_FOUND', 404);
      else if (action !== 'get') {
        if (body.revision !== routine.revision) return failure('CONFLICT');
        routine = { ...routine, revision: routine.revision + 1,
          ...(action === 'patch' ? body.patch as Input : {}), ...(action === 'archive' || action === 'restore' ? { archived: action === 'archive' } : {}) };
      }
      result = { ...routine };
    }
    if (!state.discoveryOnly && operation.startsWith('research.')) {
      if (operation === 'research.analyzeSelectedOnly') {
        if (body.sendOwnerPreviews === true) return failure('BAD_REQUEST');
        runId = String(body.requestId); phase = 'queued'; polls = 0;
        result = { runId, queued: ['session'], progress: { path: 'research.selectedProgress', input: { organizationId: 'org', runId, sessionIds: ['session'] } } };
      } else {
        if (body.runId !== runId) return failure('CONFLICT');
        if (operation === 'research.pauseSelectedOnly') phase = 'paused';
        if (operation === 'research.resumeSelectedOnly') { phase = 'queued'; polls = 0; }
        if (operation === 'research.selectedProgress') {
          if (phase !== 'paused' && ++polls >= 3) phase = 'completed';
          result = { state: phase === 'paused' ? 'blocked' : phase === 'completed' ? 'completed' : 'running', terminal: phase === 'completed', items: [{ id: 'session', status: phase }] };
        } else result = { outcome: 'completed', completion: 'Control applied; analysis completion is separate.', items: [{ id: 'session', outcome: phase }] };
      }
    }
    const response = { result, ...(typeof operationId === 'string' ? { operation: { id: operationId, path: operation, state: 'completed' } } : {}) };
    if (typeof operationId === 'string') receipts.set(operationId, { signature, response });
    if (item.mutation && state.failAfterCommit && !lostResponse) { lostResponse = true; return failure('RESPONSE_LOST_AFTER_COMMIT', 503); }
    return Response.json(response);
  } });
  const env = { ...process.env, O11_CONFIG_DIR: directory, O11_SERVER: `http://127.0.0.1:${server.port}`, O11_TOKEN: 'fixture-only-token', O11_TOKEN_FILE: '' };
  async function run(runtime: string, args: string[], input?: Input) {
    const file = join(directory, 'input.json');
    if (input) await writeFile(file, JSON.stringify(input), { mode: 0o600 });
    const child = Bun.spawn([runtime, executable, ...args, ...(input ? ['--input', file] : [])], { env, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const lines = !stdout.trim() ? [] : args[0] === 'watch' ? stdout.trim().split('\n').map(line => JSON.parse(line) as Input) : [JSON.parse(stdout) as Input];
    expect(stdout + stderr).not.toContain('fixture-only-token');
    return { code, stdout, stderr, value: lines.at(-1) ?? {}, lines };
  }
  return { run, state, requests, receipts, close: async () => { server.stop(true); await rm(directory, { recursive: true, force: true }); } };
}

test.each(runtimes)('%s built CLI discovers schemas and runs the revision-checked lifecycle', async runtime => {
  const f = await fixture();
  try {
    expect((await f.run(runtime, ['commands', '--all'])).code).toBe(0);
    expect((await f.run(runtime, ['routines', 'create', '--help'])).value.result).toMatchObject({ path: 'engagement.routines.create', mutation: true });
    const operationId = uuid(), create = { organizationId: 'org', name: 'Harness routine', _operationId: operationId };
    expect((await f.run(runtime, ['routines', 'create'], { organizationId: 'org', name: 'Missing ID' })).code).toBe(1);
    expect((await f.run(runtime, ['routines', 'create'], create)).value.result).toMatchObject({ revision: 1 });
    expect((await f.run(runtime, ['routines', 'create'], create)).value.result).toMatchObject({ revision: 1 });
    expect((await f.run(runtime, ['routines', 'create'], { ...create, name: 'Changed' })).stderr).toContain('CONFLICT');
    expect((await f.run(runtime, ['routines', 'get', '--organization-id', 'org', '--id', 'routine'])).value.result).toMatchObject({ name: 'Harness routine', revision: 1 });
    const patch = { organizationId: 'org', id: 'routine', revision: 1, patch: { name: 'Updated' }, _operationId: uuid() };
    expect((await f.run(runtime, ['routines', 'patch'], patch)).value.result).toMatchObject({ name: 'Updated', revision: 2 });
    expect((await f.run(runtime, ['routines', 'patch'], { ...patch, _operationId: uuid() })).stderr).toContain('CONFLICT');
    expect((await f.run(runtime, ['routines', 'archive'], { organizationId: 'org', id: 'routine', revision: 2, _operationId: uuid() })).value.result).toMatchObject({ archived: true, revision: 3 });
    expect((await f.run(runtime, ['routines', 'restore'], { organizationId: 'org', id: 'routine', revision: 3, _operationId: uuid() })).value.result).toMatchObject({ archived: false, revision: 4 });
    expect(f.receipts.size).toBe(4);
  } finally { await f.close(); }
}, 30_000);

test.each(runtimes)('%s built CLI submits no-send work, pauses, resumes and watches durable progress', async runtime => {
  const f = await fixture(), runId = uuid();
  const selected = { organizationId: 'org', runId, sessionIds: ['session'] };
  try {
    const submitted = await f.run(runtime, ['research', 'analyze-selected-only'], { organizationId: 'org', requestId: runId, sessionIds: ['session'], routineIds: ['routine'], _operationId: uuid() });
    expect(submitted.code).toBe(0); expect(submitted.value.result).toMatchObject({ runId });
    expect((await f.run(runtime, ['research', 'pause-selected-only', '--check'], { ...selected, _operationId: uuid() })).code).toBe(0);
    expect((await f.run(runtime, ['research', 'selected-progress', '--check'], selected)).code).toBe(2);
    expect((await f.run(runtime, ['research', 'resume-selected-only', '--check'], { ...selected, _operationId: uuid() })).code).toBe(0);
    const watch = await f.run(runtime, ['watch', '--path', 'research.selectedProgress', '--timeout', '1500', '--interval', '20'], selected);
    expect(watch.code).toBe(0); expect(watch.lines.map(line => line.event)).toEqual(['state', 'state', 'complete']);
    expect(watch.value.value).toMatchObject({ state: 'success' });
    const before = f.receipts.size;
    expect((await f.run(runtime, ['research', 'analyze-selected-only'], { organizationId: 'org', requestId: uuid(), sendOwnerPreviews: true, _operationId: uuid() })).code).toBe(1);
    expect(f.receipts.size).toBe(before);
  } finally { await f.close(); }
}, 30_000);

test.each(runtimes)('%s built CLI handles failed checks, safe read retries and uncertain-write recovery', async runtime => {
  const f = await fixture();
  try {
    f.state.status = ['blocked']; f.state.retryReads = 1;
    expect((await f.run(runtime, ['check', '--organization-id', 'org'])).code).toBe(2);
    expect(f.requests.filter(request => request.path === 'status')).toHaveLength(2);
    f.state.failAfterCommit = true;
    const operationId = uuid(), create = { organizationId: 'org', name: 'Recovered', _operationId: operationId };
    const failed = await f.run(runtime, ['routines', 'create'], create);
    expect(failed.code).toBe(1); expect(failed.stderr).toContain(operationId);
    expect(f.requests.filter(request => request.path === 'execute/engagement.routines.create')).toHaveLength(1);
    expect((await f.run(runtime, ['operations', 'status', '--organization-id', 'org', '--id', operationId])).value.result).toMatchObject({ state: 'completed', id: operationId });
    expect((await f.run(runtime, ['wait', '--organization-id', 'org', '--id', operationId, '--timeout', '1000', '--interval', '20'])).value.state).toBe('success');
    expect((await f.run(runtime, ['routines', 'create'], create)).value.result).toMatchObject({ revision: 1 });
    expect(f.receipts.size).toBe(1);
    const before = f.requests.length;
    expect((await f.run(runtime, ['status', '--organization-id', 'wrong', '--expect-organization', 'org'])).code).toBe(1);
    expect(f.requests).toHaveLength(before);
  } finally { await f.close(); }
}, 30_000);

test.each(runtimes)('%s preserves human-only refusals for discovered OAuth commands', async runtime => {
  const f = await fixture();
  try {
    for (const words of [['analytics', 'start-oauth'], ['knowledge', 'mcp-oauth-start']]) {
      const result = await f.run(runtime, words, { organizationId: 'org', _operationId: uuid() });
      expect(result.code).toBe(1); expect(result.stderr).toContain('HUMAN_ACTION_REQUIRED');
    }
  } finally { await f.close(); }
});

test.each(runtimes)('%s wait stops on a blocked durable job instead of waiting for its deadline', async runtime => {
  const f = await fixture(), runId = uuid(), input = { organizationId: 'org', runId, sessionIds: ['session'] };
  try {
    await f.run(runtime, ['research', 'analyze-selected-only'], { organizationId: 'org', requestId: runId, _operationId: uuid() });
    await f.run(runtime, ['research', 'pause-selected-only'], { ...input, _operationId: uuid() });
    const waited = await f.run(runtime, ['wait', '--path', 'research.selectedProgress', '--timeout', '150', '--interval', '20'], input);
    expect(waited.code).toBe(2); expect(waited.value.state).toBe('failure');
  } finally { await f.close(); }
});

test.skipIf(!process.env.O11_HARNESS_CATALOG)('every discovered backend operation is reachable through its published command under Node and Bun', async () => {
  const descriptors = JSON.parse(await readFile(process.env.O11_HARNESS_CATALOG!, 'utf8')) as Descriptor[];
  const f = await fixture(descriptors); f.state.discoveryOnly = true;
  const failures: Input[] = [];
  try {
    for (const runtime of runtimes) for (const item of descriptors) {
      const result = await f.run(runtime, item.command.split(' '), { organizationId: 'org', ...(item.mutation ? { _operationId: uuid() } : {}) });
      if (item.available ? result.code !== 0 || (result.value.result as Input | undefined)?.receivedPath !== item.path : !result.stderr.includes('HUMAN_ACTION_REQUIRED')) failures.push({ runtime, path: item.path, command: item.command, code: result.code, stderr: result.stderr.slice(0, 500) });
    }
    if (process.env.O11_HARNESS_REPORT) await writeFile(process.env.O11_HARNESS_REPORT, JSON.stringify({ operations: descriptors.length, executions: descriptors.length * runtimes.length, failures }, null, 2));
    expect(failures).toEqual([]);
  } finally { await f.close(); }
}, 240_000);
