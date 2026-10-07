import { z } from 'zod';
import type { ApiClient } from './http-client';

const outcome = z.enum(['matched', 'not_matched', 'inconclusive']);
export const verificationManifest = z.object({
  version: z.literal(1), organizationId: z.string().min(1).max(128), environment: z.enum(['test', 'production']),
  connectorId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), routineId: z.string().min(1).max(128), revision: z.number().int().nonnegative(),
  cases: z.array(z.object({ id: z.string().min(1).max(100), sessionId: z.string().min(1).max(128), expected: outcome,
    tags: z.array(z.string().min(1).max(100)).max(20).default([]) }).strict()).min(2).max(100),
  requiredTags: z.array(z.string().min(1).max(100)).max(50).default([]),
  baseline: z.array(z.object({ id: z.string(), actual: outcome, resultVersion: z.string().nullable() }).strict()).max(100).optional(),
  minimumPrecision: z.number().min(0).max(1).default(1), minimumRecall: z.number().min(0).max(1).default(1),
}).strict().refine(value => new Set(value.cases.map(item => item.id)).size === value.cases.length, 'Case IDs must be unique.')
  .refine(value => new Set(value.cases.map(item => item.sessionId)).size === value.cases.length, 'Use each recording once.')
  .refine(value => value.cases.some(item => item.expected === 'matched') && value.cases.some(item => item.expected === 'not_matched'), 'Include a labeled match and a labeled nonmatch.');
const observation = z.object({ organizationId: z.string(), environment: z.string(), connectorId: z.string(), routineId: z.string(), revision: z.number(), sessionId: z.string(),
  outcome, reason: z.string(), observedRevision: z.number().nullable(), checkedAt: z.string().nullable(),
  ruleId: z.string(), resultVersion: z.string().nullable(), executionId: z.string().nullable(), evidence: z.array(z.string()), findings: z.number() });
export type VerificationCase = { id: string; sessionId: string; expected: z.infer<typeof outcome>; actual: z.infer<typeof outcome>;
  passed: boolean; error?: string; checkedAt?: string | null; executionId?: string | null; ruleId?: string; resultVersion?: string | null; evidence: string[]; tags: string[] };

export function verificationMetrics(cases: VerificationCase[]) {
  const count = (expected: VerificationCase['expected'], actual: VerificationCase['actual']) => cases.filter(item => item.expected === expected && item.actual === actual).length;
  const truePositive = count('matched', 'matched'), falsePositive = count('not_matched', 'matched');
  const falseNegative = count('matched', 'not_matched'), trueNegative = count('not_matched', 'not_matched');
  const positive = cases.filter(item => item.expected === 'matched').length;
  const required = cases.filter(item => item.expected !== 'inconclusive');
  return { truePositive, falsePositive, falseNegative, trueNegative,
    inconclusive: cases.filter(item => item.actual === 'inconclusive').length,
    precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null,
    recall: positive ? truePositive / positive : null,
    coverage: required.length ? required.filter(item => item.actual !== 'inconclusive' && !item.error).length / required.length : 0,
    passed: cases.filter(item => item.passed).length, total: cases.length };
}

/** Reads saved evaluations only. Labels come from the caller; this command never starts analysis or contact. */
export async function verify(raw: unknown, api: Pick<ApiClient, 'request'>, options: { signal?: AbortSignal } = {}) {
  const parsed = verificationManifest.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid verification manifest. Use version 1, exact workspace/routine/revision, and unique recordings labeled matched and not_matched.');
  const input = parsed.data, cases = new Array<VerificationCase>(input.cases.length);
  let next = 0;
  const scope = { organizationId: input.organizationId, environment: input.environment, connectorId: input.connectorId, routineId: input.routineId, revision: input.revision };
  const worker = async () => {
    for (;;) {
      const index = next++, item = input.cases[index]; if (!item) return;
      const base = { id: item.id, sessionId: item.sessionId, expected: item.expected, tags: item.tags };
      try {
        options.signal?.throwIfAborted();
        const reply = await api.request('execute/research.evaluation', { ...scope, sessionId: item.sessionId }, { signal: options.signal });
        const result = observation.parse(reply.result);
        if (result.organizationId !== input.organizationId || result.environment !== input.environment || result.connectorId !== input.connectorId || result.routineId !== input.routineId || result.revision !== input.revision || result.sessionId !== item.sessionId) throw new Error('Context mismatch');
        const usable = result.outcome === 'inconclusive' || (result.observedRevision === input.revision && !!result.executionId && !!result.checkedAt && !!result.resultVersion && result.evidence.length > 0 && (result.outcome !== 'matched' || result.findings > 0));
        const actual = usable ? result.outcome : 'inconclusive';
        cases[index] = { ...base, actual, passed: usable && actual === item.expected, ...(!usable ? { error: 'UNVERIFIED_RESULT' } : {}),
          checkedAt: result.checkedAt, executionId: result.executionId, ruleId: result.ruleId, resultVersion: result.resultVersion, evidence: usable ? result.evidence : [] };
      } catch {
        cases[index] = { ...base, actual: 'inconclusive', passed: false, error: options.signal?.aborted ? 'CANCELLED' : 'EVALUATION_UNAVAILABLE', evidence: [] };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, input.cases.length) }, worker));
  let revisionCurrent = false;
  try {
    options.signal?.throwIfAborted();
    const saved = await api.request('execute/engagement.routines.get', { organizationId: input.organizationId, id: input.routineId }, { signal: options.signal });
    revisionCurrent = z.object({ id: z.literal(input.routineId), revision: z.literal(input.revision) }).safeParse(saved.result).success;
  } catch { /* Verification fails closed if final revision readback cannot finish. */ }
  const metrics = verificationMetrics(cases);
  const missingTags = input.requiredTags.filter(tag => !cases.some(item => item.tags.includes(tag)));
  const drift = (input.baseline ?? []).flatMap(previous => {
    const current = cases.find(item => item.id === previous.id);
    return !current || current.actual !== previous.actual || current.resultVersion !== previous.resultVersion
      ? [{ id: previous.id, previous: previous.actual, current: current?.actual ?? null, previousVersion: previous.resultVersion, currentVersion: current?.resultVersion ?? null }] : [];
  });
  const verified = missingTags.length === 0 && revisionCurrent && metrics.coverage === 1 && !cases.some(item => item.error || (item.expected === 'inconclusive' && !item.passed))
    && metrics.precision !== null && metrics.precision >= input.minimumPrecision && metrics.recall !== null && metrics.recall >= input.minimumRecall;
  return { version: 1, ...scope, verified, revisionCurrent, checkedAt: new Date().toISOString(),
    missingTags, baselineCompared: input.baseline !== undefined, drift, thresholds: { precision: input.minimumPrecision, recall: input.minimumRecall }, metrics, cases,
    limitations: ['Accuracy applies to the caller-labeled recordings in this manifest.', 'This command reads saved evidence; it does not run the detector or establish future worker health.'] };
}
