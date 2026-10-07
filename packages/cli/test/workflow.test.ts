import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySetup, setupPlan } from '../src/setup';
import { healthIssues } from '../src/health';
import { waitFor } from '../src/wait';
import { pinnedInput } from '../src/profiles-command';
const context = { organizationId: 'org', routineId: 'routine' };
const action = { tool: 'engagement_routines_validateSignal', input: { organizationId: 'org', id: 'routine', revision: 1 }, available: true, autoApply: true };
const snapshot = (actions = [action]) => ({ result: { organizationId: 'org', workflow: { state: 'configured', actions } } });

test('setup plans only authorize known no-send actions with explicit server opt-in', () => {
  const result = setupPlan(snapshot([action, { ...action, tool: 'engagement_routines_publish' }, { ...action, autoApply: false }, { ...action, available: false }]));
  expect(result.steps.map(step => step.autoApply)).toEqual([true, false, false, false]);
});
test('setup persists a private operation ID before dispatch and reuses it after interruption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-setup-'));
  const journal = join(dir, 'journal.json'); const ids: unknown[] = [];
  let completed = false;
  const api = { async request(path: string, input?: Record<string, unknown>) {
    if (path === 'status') return snapshot(completed ? [] : [action]);
    const saved = JSON.parse(await readFile(journal, 'utf8')) as { entries: Record<string, { operationId: string }> };
    expect(Object.values(saved.entries)[0]!.operationId).toBe(String(input?._operationId));
    ids.push(input?._operationId);
    if (ids.length === 1) throw new Error('connection lost after remote acceptance');
    completed = true; return { result: { valid: true } };
  } };
  try {
    const options = { journal, server: 'https://example.test', profile: 'test', maxSteps: 3 };
    await expect(applySetup(api, context, options)).rejects.toThrow('connection lost');
    await applySetup(api, context, options);
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]); expect((await stat(journal)).mode & 0o777).toBe(0o600);
    await expect(applySetup(api, { ...context, routineId: 'different' }, options)).rejects.toThrow('another target');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('setup refuses a server action for another workspace or routine', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-setup-context-')); let calls = 0;
  const api = { async request(path: string) { if (path !== 'status') calls++; return snapshot([{ ...action, input: { ...action.input, id: 'other' } }]); } };
  try { await expect(applySetup(api, context, { journal: join(dir, 'j'), server: 'https://example.test', profile: 'a', maxSteps: 2 })).rejects.toThrow('routine'); expect(calls).toBe(0); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('health checks reject saved-but-unverified workflows, unavailable capabilities, and deferred imports', () => {
  expect(healthIssues(snapshot())).toContain('Current revision has no verified execution.');
  expect(healthIssues({ result: { workflow: { state: 'verified' }, readiness: { replayMonitoring: false } } }, { capabilities: ['replayMonitoring'] })).toEqual(['Capability unavailable: replayMonitoring.']);
  expect(healthIssues({ result: { outcome: 'deferred' } })).toEqual(['Operation deferred.']);
  expect(healthIssues({ result: { workflow: { state: 'verified', status: { sources: [{ id: 'source', import: { lastSuccessAt: new Date().toISOString() } }] } } } }, { maxLagSeconds: 60 })).toEqual([]);
});
test('watch suppresses unchanged snapshots, waits for evidence, and reports local cancellation', async () => {
  let calls = 0; const changes: unknown[] = [];
  const result = await waitFor(async () => ({ result: { workflow: { state: ++calls < 3 ? 'scheduled' : 'verified', checkedAt: new Date().toISOString() } } }), { timeoutMs: 1000, intervalMs: 10, changed: value => changes.push(value) });
  expect(result.state).toBe('success'); expect(changes).toHaveLength(2);
  const controller = new AbortController(); controller.abort();
  const cancelled = await waitFor(async () => { throw new Error('must not read'); }, { timeoutMs: 1000, intervalMs: 10, signal: controller.signal });
  expect(cancelled.state).toBe('cancelled'); expect(cancelled.message).toContain('Remote work was not cancelled');
});
test('workspace pins fill omitted context and reject mismatched explicit values', () => {
  expect(pinnedInput({}, { organizationId: 'org' })).toEqual({ organizationId: 'org' });
  expect(() => pinnedInput({ environment: 'production' }, { environment: 'test' })).toThrow('Context mismatch');
});
