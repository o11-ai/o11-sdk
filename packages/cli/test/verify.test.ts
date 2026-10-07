import { expect, test } from 'bun:test';
import { verify, verificationManifest } from '../src/verify';
const scope = { organizationId: 'org', environment: 'production', connectorId: 'posthog', routineId: 'routine', revision: 4 };
const manifest = { version: 1, ...scope, cases: [
  { id: 'positive', sessionId: 'yes', expected: 'matched' }, { id: 'negative', sessionId: 'no', expected: 'not_matched' },
] };
const result = (input: Record<string, unknown> = {}) => ({ ...scope, ...input,
  outcome: input.sessionId === 'yes' ? 'matched' : 'not_matched', reason: 'Completed evaluation', observedRevision: 4,
  checkedAt: '2026-10-06T00:00:00Z', ruleId: 'rule', resultVersion: 'rules-v1', executionId: 'run', evidence: ['report-key'], findings: input.sessionId === 'yes' ? 1 : 0 });
const api = (change: (value: ReturnType<typeof result>) => Record<string, unknown> = value => value, revision = 4) => ({
  async request(path: string, input?: Record<string, unknown>) {
    return { result: path.endsWith('.get') ? { id: 'routine', revision } : change(result(input)) };
  },
});
test('verification measures labeled positives and negatives using exact saved evidence', async () => {
  const report = await verify(manifest, api());
  expect(report.verified).toBe(true);
  expect(report.metrics).toMatchObject({ truePositive: 1, trueNegative: 1, falsePositive: 0, falseNegative: 0, coverage: 1, precision: 1, recall: 1 });
});
test('false positives and false negatives fail the default accuracy thresholds', async () => {
  const fp = await verify(manifest, api(value => ({ ...value, outcome: 'matched', findings: 1 })));
  expect(fp.verified).toBe(false); expect(fp.metrics.precision).toBe(0.5); expect(fp.metrics.falsePositive).toBe(1);
  const fn = await verify(manifest, api(value => ({ ...value, outcome: 'not_matched', findings: 0 })));
  expect(fn.verified).toBe(false); expect(fn.metrics.recall).toBe(0); expect(fn.metrics.falseNegative).toBe(1);
});
test('missing evidence, stale executions, and cross-workspace replies cannot pass', async () => {
  for (const patch of [{ evidence: [] }, { executionId: null }, { observedRevision: 3 }, { organizationId: 'other' }]) {
    const report = await verify(manifest, api(value => ({ ...value, ...patch })));
    expect(report.verified).toBe(false); expect(report.metrics.coverage).toBe(0);
  }
  expect((await verify(manifest, api(undefined, 5))).revisionCurrent).toBe(false);
});
test('request failures never satisfy an expected unknown case or disclose raw failures', async () => {
  const report = await verify({ ...manifest, cases: [...manifest.cases, { id: 'unknown', sessionId: 'missing', expected: 'inconclusive' }] }, {
    async request() { throw new Error('secret-token-and-customer-content'); },
  });
  expect(report.verified).toBe(false); expect(report.cases[2]?.passed).toBe(false);
  expect(JSON.stringify(report)).not.toContain('secret-token');
});
test('manifest requires independent labels and rejects duplicated recordings', () => {
  expect(verificationManifest.safeParse({ ...manifest, cases: [manifest.cases[0], { ...manifest.cases[1], sessionId: 'yes' }] }).success).toBe(false);
  expect(verificationManifest.safeParse({ ...manifest, cases: manifest.cases.map(item => ({ ...item, expected: 'matched' })) }).success).toBe(false);
});
test('evaluation reads have bounded concurrency and abort preserves inconclusive results', async () => {
  let active = 0, peak = 0;
  const report = await verify({ ...manifest, cases: Array.from({ length: 12 }, (_, index) => ({ id: String(index), sessionId: String(index), expected: index % 2 ? 'matched' : 'not_matched' })) }, {
    async request(path: string, input?: Record<string, unknown>) {
      active++; peak = Math.max(peak, active); await Bun.sleep(2); active--;
      return { result: path.endsWith('.get') ? { id: 'routine', revision: 4 } : result(input) };
    },
  });
  expect(peak).toBe(4); expect(report.cases).toHaveLength(12);
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const cancelled = await verify(manifest, { async request() { calls++; return {}; } }, { signal: controller.signal });
  expect(calls).toBe(0); expect(cancelled.verified).toBe(false); expect(cancelled.cases.every(item => item.error === 'CANCELLED')).toBe(true);
});
test('required boundary labels and saved evaluation baselines expose coverage and drift', async () => {
  const report = await verify({ ...manifest, requiredTags: ['duplicate-submissions'], baseline: [{ id: 'positive', actual: 'not_matched', resultVersion: 'rules-v0' }] }, api());
  expect(report.verified).toBe(false); expect(report.missingTags).toEqual(['duplicate-submissions']);
  expect(report.drift).toEqual([{ id: 'positive', previous: 'not_matched', current: 'matched', previousVersion: 'rules-v0', currentVersion: 'rules-v1' }]);
});
