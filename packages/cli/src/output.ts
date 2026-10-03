import { open } from 'node:fs/promises';
/** Reserve a private destination before dispatching a mutation. Never overwrite a receipt. */
export async function callWithOutput<T>(call: () => Promise<T>, path?: string): Promise<T> {
  const file = path ? await open(path, 'wx', 0o600) : undefined;
  try {
    const result = await call();
    if (file) { await file.writeFile(JSON.stringify(result, null, 2)); await file.sync(); }
    return result;
  } finally { await file?.close(); }
}
