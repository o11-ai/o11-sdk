import { z } from 'zod';
import { object } from './http-client';
import { payload } from './health';
export function validateInput(input: Record<string, unknown>, descriptor: Record<string, unknown>) {
  const command = payload(descriptor);
  if (!object(command.inputSchema)) throw new Error('This command has no input schema.');
  let schema: z.ZodType;
  try { schema = z.fromJSONSchema(command.inputSchema); }
  catch { throw new Error('This schema cannot be checked locally. Inspect its command help; the server validates execution.'); }
  const checked = schema.safeParse(input);
  return { path: command.path, valid: checked.success, mutation: command.mutation === true,
    issues: checked.success ? [] : checked.error.issues.map(issue => ({ path: issue.path.map(String).join('.'), code: issue.code, message: issue.message })),
    ...(descriptor.cache ? { cache: descriptor.cache } : {}),
    verification: 'Input structure only. Execution, permissions, provider access, and detection behavior remain unverified.' };
}
