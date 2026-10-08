import { z } from 'zod';
import { ApiError, type ApiClient } from './http-client';
import { healthIssues, payload } from './health';
import { pinnedInput } from './profiles-command';
import { validateInput } from './validate';
import { createHash } from 'node:crypto';
import { readPrivateJson, writePrivateJson } from './local-state';
import { withWorkflowLock } from './credential-lock';
import { object } from './http-client';
import { applyPinnedEnvironment } from './schema-flags';
const manifest = z.object({ version: z.literal(1), organizationId: z.string().optional(), environment: z.enum(['test', 'production']).optional(),
  concurrency: z.number().int().min(1).max(8).default(1),
  items: z.array(z.object({ id: z.string().min(1).max(100), path: z.string().regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/), input: z.record(z.string(), z.unknown()) }).strict()).min(1).max(100),
}).strict().refine(value => new Set(value.items.map(item => item.id)).size === value.items.length, 'Batch item IDs must be unique.');
/** Each mutation must already have an operation ID; rerunning the manifest uses its existing receipts. */
export async function runBatch(raw: unknown, api: Pick<ApiClient, 'request'>, options: { journal?: string; target?: string } = {}) {
  const parsed = manifest.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid batch manifest. Use version 1, concurrency 1–8, and up to 100 unique items with id, path, and input.');
  const input = parsed.data;
  if (options.journal) return withWorkflowLock(options.journal, () => batch(input, api, options));
  return batch(input, api, options);
}
async function batch(input: z.infer<typeof manifest>, api: Pick<ApiClient, 'request'>, options: { journal?: string; target?: string }) {
  const fingerprint = createHash('sha256').update(JSON.stringify({ target: options.target, input })).digest('hex');
  const saved = options.journal ? await readPrivateJson(options.journal) : undefined;
  if (saved !== undefined && (!object(saved) || saved.fingerprint !== fingerprint || !object(saved.completed))) throw new Error('Batch journal does not match this manifest and target.');
  const completed: Record<string, boolean> = Object.assign(Object.create(null) as Record<string, boolean>, object(saved) && object(saved.completed) ? saved.completed : {});
  const pending: Record<string, { operationId?: string }> = Object.create(null) as Record<string, { operationId?: string }>;
  let saving = Promise.resolve();
  const save = () => { saving = saving.then(async () => { if (options.journal) await writePrivateJson(options.journal, { version: 1, fingerprint, completed, pending }); }); return saving; };
  const results = new Array<Record<string, unknown>>(input.items.length); let next = 0;
  // One invocation shares discovery only; every execution still authorizes on the server.
  const descriptors = new Map<string, Promise<Record<string, unknown>>>();
  const describe = (path: string) => {
    let pending = descriptors.get(path);
    if (!pending) { pending = Promise.resolve().then(() => api.request('commands/' + encodeURIComponent(path))); descriptors.set(path, pending); }
    return pending;
  };
  const worker = async () => {
    for (;;) {
      const index = next++, item = input.items[index]; if (!item) return;
      if (completed[item.id] === true) { results[index] = { id: item.id, state: 'completed', resumed: true, ...(typeof item.input._operationId === 'string' ? { operationId: item.input._operationId } : {}) }; continue; }
      try {
        const pinned = pinnedInput(item.input, { organizationId: input.organizationId, environment: input.environment });
        const descriptor = await describe(item.path);
        const args = applyPinnedEnvironment(pinned, item.input.environment === undefined && !!input.environment, descriptor);
        if (payload(descriptor).mutation === true && !z.uuid().safeParse(args._operationId).success) throw new Error('Batch writes require a stable UUID _operationId in each item input.');
        const check = validateInput(args, descriptor);
        if (!check.valid) { results[index] = { id: item.id, state: 'invalid', issues: check.issues }; continue; }
        pending[item.id] = { ...(typeof args._operationId === 'string' ? { operationId: args._operationId } : {}) }; await save();
        const result = await api.request('execute/' + encodeURIComponent(item.path), args);
        const issues = healthIssues(result, { execution: false });
        results[index] = { id: item.id, state: issues.length ? 'failed' : 'completed', result, ...(issues.length ? { issues } : {}) };
        if (!issues.length) {
          completed[item.id] = true; delete pending[item.id];
          try { await save(); }
          catch { results[index] = { id: item.id, state: 'failed', remoteCompleted: true, ...(typeof args._operationId === 'string' ? { operationId: args._operationId } : {}), error: { code: 'JOURNAL_SAVE_FAILED', message: 'The remote request completed but its journal could not be saved. Inspect the receipt before repeating this write.' } }; }
        }
      } catch (error) {
        results[index] = { id: item.id, state: 'failed', error: error instanceof ApiError ? error.details : { message: error instanceof Error ? error.message : 'Item failed.' } };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(input.concurrency, input.items.length) }, worker));
  return { version: 1, ...(options.journal ? { journal: options.journal } : {}), completed: results.filter(item => item.state === 'completed').length, failed: results.filter(item => item.state !== 'completed').length, results };
}
