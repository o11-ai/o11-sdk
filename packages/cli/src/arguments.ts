import { readCallInput } from './call-input';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
export const options = {
  server: { type: 'string' }, profile: { type: 'string' }, input: { type: 'string' }, search: { type: 'string' }, scope: { type: 'string' },
  'no-browser': { type: 'boolean' }, reauth: { type: 'boolean' }, 'credential-store': { type: 'string' }, 'operation-id': { type: 'string' }, 'output-file': { type: 'string' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }, json: { type: 'boolean' }, live: { type: 'boolean' }, all: { type: 'boolean' },
  id: { type: 'string' }, 'organization-id': { type: 'string' }, environment: { type: 'string' }, 'project-id': { type: 'string' },
  'source-id': { type: 'string' }, revision: { type: 'string' }, limit: { type: 'string' }, offset: { type: 'string' },
  name: { type: 'string' }, description: { type: 'string' }, 'routine-id': { type: 'string' }, 'customer-id': { type: 'string' },
  'expected-updated-at': { type: 'string' }, 'include-disabled': { type: 'boolean' },
  fields: { type: 'string' }, set: { type: 'string', multiple: true },
  'set-file': { type: 'string', multiple: true }, check: { type: 'boolean' },
  'expect-organization': { type: 'string' }, 'expect-environment': { type: 'string' },
  timeout: { type: 'string' }, interval: { type: 'string' }, journal: { type: 'string' },
  'max-steps': { type: 'string' }, 'require-capability': { type: 'string', multiple: true },
  'max-lag-seconds': { type: 'string' }, offline: { type: 'boolean' },
  path: { type: 'string' },
} as const;
type Values = { input?: string; set?: string[]; [key: string]: string | string[] | boolean | undefined };
export async function readInput(values: Values): Promise<Record<string, unknown>> {
  const input = await readCallInput(values.input, typeof values['operation-id'] === 'string' ? values['operation-id'] : undefined);
  const put = (key: string, value: unknown) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid field name.');
    if (Object.hasOwn(input, key) && JSON.stringify(input[key]) !== JSON.stringify(value)) throw new Error(`Conflicting values for ${key}.`);
    input[key] = value;
  };
  for (const key of ['id', 'name', 'description', 'organization-id', 'environment', 'project-id', 'source-id', 'routine-id', 'customer-id', 'expected-updated-at', 'include-disabled', 'operation-id']) {
    if (values[key] !== undefined) put(key === 'operation-id' ? '_operationId' : key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), values[key]);
  }
  for (const key of ['revision', 'limit', 'offset']) {
    if (values[key] === undefined) continue;
    const value = Number(values[key]);
    if (!Number.isSafeInteger(value) || value < 0 || !/^\d+$/.test(String(values[key]))) throw new Error(`--${key} requires a nonnegative integer.`);
    put(key === 'limit' ? '_resultLimit' : key === 'offset' ? '_resultOffset' : key, value);
  }
  if (typeof values.fields === 'string') put('_resultFields', values.fields.split(','));
  for (const item of values.set ?? []) {
    const split = item.indexOf('=');
    if (split < 1) throw new Error('Use --set field=JSON (quote text as a JSON string).');
    let value: unknown;
    try { value = JSON.parse(item.slice(split + 1)); } catch { throw new Error('Field values must be valid JSON.'); }
    put(item.slice(0, split), value);
  }
  const references = values['set-file'];
  if (Array.isArray(references)) for (const item of references) {
    const split = item.indexOf('=');
    if (split < 1) throw new Error('Use --set-file field=PATH to read a private UTF-8 value.');
    const file = await open(item.slice(split + 1), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1048576 || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw new Error('Secret references require a private regular file owned by this user of at most 1 MiB (chmod 600).');
      put(item.slice(0, split), await file.readFile('utf8'));
    } finally { await file.close(); }
  }
  return input;
}
