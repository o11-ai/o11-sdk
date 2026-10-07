import { createHash } from 'node:crypto';
import { object, type ApiClient } from './http-client';
import { healthIssues, payload } from './health';
import { readPrivateJson, writePrivateJson } from './local-state';
import { withWorkflowLock } from './credential-lock';
import { ApiError } from './http-client';
export const setupAllowedPaths = new Set(['engagement.routines.validateSignal', 'engagement.routines.configureMonitoring', 'engagement.routines.refreshSetup']);
interface Entry { operationId: string; state: 'pending' | 'completed'; }
interface Journal { version: 1; target: string; entries: Record<string, Entry>; }
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function parseJournal(value: unknown, target: string): Journal {
  if (value === undefined) return { version: 1, target, entries: {} };
  if (!object(value) || value.version !== 1 || value.target !== target || !object(value.entries)) throw new Error('Setup journal belongs to another target or has an unsupported format.');
  const entries: Record<string, Entry> = {};
  for (const [key, item] of Object.entries(value.entries)) {
    if (!object(item) || typeof item.operationId !== 'string' || !['pending', 'completed'].includes(String(item.state))) throw new Error('Invalid setup journal.');
    entries[key] = { operationId: item.operationId, state: item.state as Entry['state'] };
  }
  return { version: 1, target, entries };
}
export function setupPlan(snapshot: Record<string, unknown>) {
  const result = payload(snapshot), workflow = object(result.workflow) ? result.workflow : {};
  const next = Array.isArray(workflow.next) ? workflow.next : Array.isArray(workflow.actions) ? workflow.actions : [];
  return { snapshot, steps: next.filter(object).map((action): Record<string, unknown> & { path: string; autoApply: boolean } => {
    const path = typeof action.path === 'string' ? action.path : typeof action.tool === 'string' ? action.tool.replaceAll('_', '.') : '';
    return { ...action, path, autoApply: action.autoApply === true && action.available === true && setupAllowedPaths.has(path) };
  }) };
}
export async function applySetup(api: Pick<ApiClient, 'request'>, context: Record<string, unknown>, options: { journal: string; server: string; profile: string; maxSteps: number; signal?: AbortSignal }) {
  if (typeof context.routineId !== 'string') throw new Error('setup apply requires --routine-id.');
  return withWorkflowLock(options.journal, async () => {
    const target = digest({ server: options.server, profile: options.profile, ...context });
    const journal = parseJournal(await readPrivateJson(options.journal), target);
    for (let count = 0; count < options.maxSteps; count++) {
      options.signal?.throwIfAborted();
      const snapshot = await api.request('status', context, { signal: options.signal });
      const plan = setupPlan(snapshot);
      const step = plan.steps.find(action => action.autoApply);
      if (!step) return { ...snapshot, setup: { state: 'stopped', journal: options.journal, reason: 'No authorized automatic step remains. Inspect workflow blockers and verification.' } };
      if (!object(step.input)) throw new Error('Setup action has no valid input.');
      const input = { ...step.input };
      const workspace = payload(snapshot).organizationId;
      if (typeof workspace !== 'string' || input.organizationId !== workspace || (context.organizationId && context.organizationId !== workspace)) throw new Error('Setup action workspace does not match the inspected workspace.');
      if (input.id !== context.routineId) throw new Error('Setup action routine does not match the requested routine.');
      if (context.environment && input.environment !== undefined && input.environment !== context.environment) throw new Error('Setup action environment does not match the requested environment.');
      const key = digest({ path: step.path, input });
      const entry = journal.entries[key] ?? { operationId: crypto.randomUUID(), state: 'pending' as const };
      if (entry.state === 'completed') return { ...snapshot, setup: { state: 'stalled', journal: options.journal, reason: 'Completed step is still requested. Inspect its receipt and live state before retrying.' } };
      journal.entries[key] = entry; await writePrivateJson(options.journal, journal);
      // The same UUID and input resume an interrupted call through server receipt deduplication.
      const response = await api.request('execute/' + encodeURIComponent(step.path), { ...input, _operationId: entry.operationId }, { signal: options.signal });
      const result = payload(response);
      const state = result.state ?? result.status;
      const operation = object(response.operation) ? response.operation : object(result.operation) ? result.operation : undefined;
      // An HTTP success can still describe deferred, refused, or unfinished work.
      // Keep its existing UUID pending so resumption consults the same receipt.
      const incomplete = healthIssues(response, { execution: false }).length > 0
        || (typeof state === 'string' && !['completed', 'succeeded', 'valid', 'verified'].includes(state))
        || (operation && operation.state !== 'completed');
      if (incomplete) return { ...response, setup: { state: 'blocked', journal: options.journal, operationId: entry.operationId } };
      entry.state = 'completed';
      try { await writePrivateJson(options.journal, journal); }
      catch { throw new ApiError(0, { code: 'JOURNAL_SAVE_FAILED', remoteCompleted: true, operationId: entry.operationId, message: 'The remote setup action completed but its journal could not be saved. Inspect its receipt before repeating the write.' }); }
    }
    return { ...await api.request('status', context, { signal: options.signal }), setup: { state: 'step_limit', journal: options.journal, reason: 'Step limit reached. Resume with the same journal.' } };
  });
}
