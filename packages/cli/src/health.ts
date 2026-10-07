import { object } from './http-client';
export function payload(value: unknown): Record<string, unknown> { return object(value) && object(value.result) ? value.result : object(value) ? value : {}; }
export interface HealthOptions { capabilities?: string[]; maxLagSeconds?: number; execution?: boolean; requireOutcome?: boolean; }
export function healthIssues(value: unknown, options: HealthOptions = {}): string[] {
  const result = payload(value), issues: string[] = [];
  if (result.valid === false) issues.push('Validation failed.');
  if (result.verified === false) issues.push('Verification failed.');
  if (typeof result.outcome === 'string' && result.outcome !== 'completed') issues.push(`Operation ${result.outcome}.`);
  if (result.isError === true || result.error) issues.push('Operation returned an error.');
  if (['failed', 'uncertain', 'cancelled', 'expired', 'blocked'].includes(String(result.state ?? result.status))) issues.push(`Operation ${String(result.state ?? result.status)}.`);
  const workflow = object(result.workflow) ? result.workflow : undefined;
  const routineWorkflow = workflow && (typeof workflow.state === 'string' || object(workflow.routine));
  if (routineWorkflow) {
    if (workflow.state === 'blocked') issues.push('Workflow is blocked.');
    if (options.execution !== false && workflow.state !== 'verified') issues.push('Current revision has no verified execution.');
  }
  const readiness = object(result.readiness) ? result.readiness : {};
  for (const capability of options.capabilities ?? (routineWorkflow ? [] : Object.keys(readiness))) if (readiness[capability] !== true) issues.push(`Capability unavailable: ${capability}.`);
  if (options.maxLagSeconds !== undefined) {
    const status = workflow && object(workflow.status) ? workflow.status : result;
    const sources = Array.isArray(status.sources) ? status.sources : [];
    if (!sources.length) issues.push('No source freshness evidence is available.');
    for (const source of sources) if (object(source)) {
      const state = object(source.import) ? source.import : source;
      const timestamp = typeof state.lastSuccessAt === 'string' || typeof state.lastSuccessAt === 'number' ? new Date(state.lastSuccessAt).getTime() : NaN;
      if (!Number.isFinite(timestamp) || (Date.now() - timestamp) / 1000 > options.maxLagSeconds) issues.push(`Source ${String(source.id ?? source.sourceId ?? 'unknown')} exceeds the allowed freshness lag.`);
    }
  }
  if (options.requireOutcome && !routineWorkflow && !Object.keys(readiness).length && result.valid !== true && result.verified !== true && result.outcome !== 'completed' && !['completed', 'succeeded'].includes(String(result.state ?? result.status)) && !issues.length) issues.push('No verification outcome is available. Inspect the command verification steps.');
  return issues;
}
export function terminalState(value: unknown): 'success' | 'failure' | 'pending' {
  const result = payload(value);
  const workflow = object(result.workflow) ? result.workflow : undefined;
  const operation = object(result.operation) ? result.operation : result;
  if (workflow) return workflow.state === 'verified' ? 'success' : workflow.state === 'blocked' ? 'failure' : 'pending';
  if (result.valid === false || result.outcome === 'failed' || result.isError === true || result.error) return 'failure';
  if (['failed', 'uncertain', 'cancelled', 'expired', 'blocked'].includes(String(operation.state ?? operation.status))) return 'failure';
  if (result.outcome === 'completed' || ['completed', 'succeeded'].includes(String(operation.state ?? operation.status))) return 'success';
  return 'pending';
}
