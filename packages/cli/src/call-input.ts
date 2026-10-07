import { open } from 'node:fs/promises';
import { z } from 'zod';

export async function readCallInput(path?: string, operationId?: string): Promise<Record<string, unknown>> {
  let raw = path === undefined ? '{}' : '';
  const file = path !== undefined && path !== '-' ? await open(path, 'r') : undefined;
  try {
    if (path !== undefined) {
      const stream = file ? file.createReadStream() : process.stdin;
      stream.setEncoding('utf8');
      for await (const chunk of stream) {
        raw += String(chunk);
        if (Buffer.byteLength(raw) > 1048576) throw new Error('Input exceeds 1 MiB.');
      }
    }
  } finally { await file?.close(); }
  let args: unknown;
  try { args = JSON.parse(raw); } catch { throw new Error('Input must be valid JSON.'); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Input must be a JSON object.');
  const input = args as Record<string, unknown>;
  if (operationId !== undefined) {
    if (!z.string().uuid().safeParse(operationId).success) throw new Error('Operation ID must be a UUID.');
    if (input._operationId !== undefined && input._operationId !== operationId) throw new Error('Conflicting operation IDs.');
    input._operationId = operationId;
  }
  return input;
}
