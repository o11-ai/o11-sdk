import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBatch } from '../src/batch';
import { validateInput } from '../src/validate';
const descriptor = { result: { path: 'test.save', mutation: true, inputSchema: { type: 'object', properties: { organizationId: { type: 'string' }, name: { type: 'string' }, _operationId: { type: 'string', format: 'uuid' } }, required: ['name', '_operationId'], additionalProperties: false } } };
test('nested schema validation gives field errors without printing sensitive input', () => {
  const result = validateInput({ token: 'a-secret-value', nested: { count: 'not-a-number' } }, { result: { inputSchema: { type: 'object', properties: { token: { type: 'number' }, nested: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] } } } } });
  expect(result.valid).toBe(false); expect(result.issues.map(issue => issue.path)).toEqual(['token', 'nested.count']); expect(JSON.stringify(result)).not.toContain('a-secret-value');
});
test('batch continues independent items, requires write IDs, and resumes without repeating completed work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-batch-')); const journal = join(dir, 'batch.json');
  const ids: unknown[] = []; let allow = false;
  const api = { async request(path: string, input?: Record<string, unknown>) {
    if (path.startsWith('commands/')) return descriptor;
    ids.push(input?._operationId);
    if (input?.name === 'retry' && !allow) throw new Error('network lost');
    return { result: { saved: true } };
  } };
  const good = crypto.randomUUID(), pending = crypto.randomUUID();
  const input = { version: 1, concurrency: 2, organizationId: 'org', items: [
    { id: 'ok', path: 'test.save', input: { name: 'ok', _operationId: good } },
    { id: 'pending', path: 'test.save', input: { name: 'retry', _operationId: pending } },
    { id: 'missing-id', path: 'test.save', input: { name: 'invalid' } },
  ] };
  try {
    const first = await runBatch(input, api, { journal, target: 'profile/server' });
    expect(first.completed).toBe(1); expect(first.failed).toBe(2); expect(ids).toHaveLength(2);
    allow = true; const second = await runBatch(input, api, { journal, target: 'profile/server' });
    expect(second.completed).toBe(2); expect(second.failed).toBe(1); expect(ids.filter(id => id === good)).toHaveLength(1); expect(ids.filter(id => id === pending)).toHaveLength(2);
    await expect(runBatch({ ...input, organizationId: 'different' }, api, { journal, target: 'profile/server' })).rejects.toThrow('does not match');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('100 concurrent same-path items use one schema request and authorize all 100 executions', async () => {
  let schemas = 0, executions = 0;
  const ids: unknown[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const api = { async request(path: string, input?: Record<string, unknown>) {
    if (path.startsWith('commands/')) { schemas++; await gate; return descriptor; }
    executions++; ids.push(input?._operationId); return { result: { saved: true } };
  } };
  const items = Array.from({ length: 100 }, (_, index) => ({ id: String(index), path: 'test.save', input: { name: String(index), _operationId: crypto.randomUUID() } }));
  const pending = runBatch({ version: 1, concurrency: 8, items }, api);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(schemas).toBe(1); expect(executions).toBe(0); release();
  expect(await pending).toMatchObject({ completed: 100, failed: 0 });
  expect(schemas + executions).toBe(101);
  expect(new Set(ids)).toEqual(new Set(items.map(item => item.input._operationId)));
});

test('failed concurrent discovery is shared only by its path and is rechecked on the next invocation', async () => {
  const counts = new Map<string, number>(), executed: string[] = [];
  let denied = true;
  const api = { async request(path: string) {
    counts.set(path, (counts.get(path) ?? 0) + 1);
    if (path.startsWith('commands/')) {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (path.endsWith('test.denied') && denied) throw new Error('Permission refused');
      return { result: { mutation: false, inputSchema: { type: 'object' } } };
    }
    executed.push(path); return { result: true };
  } };
  const input = { version: 1, concurrency: 8, items: Array.from({ length: 12 }, (_, index) => ({ id: String(index), path: index < 10 ? 'test.denied' : 'test.allowed', input: {} })) };
  expect(await runBatch(input, api)).toMatchObject({ completed: 2, failed: 10 });
  expect(counts.get('commands/test.denied')).toBe(1); expect(counts.get('commands/test.allowed')).toBe(1);
  expect(executed).toEqual(['execute/test.allowed', 'execute/test.allowed']);
  denied = false;
  expect(await runBatch(input, api)).toMatchObject({ completed: 12, failed: 0 });
  expect(counts.get('commands/test.denied')).toBe(2); expect(counts.get('commands/test.allowed')).toBe(2);
});
