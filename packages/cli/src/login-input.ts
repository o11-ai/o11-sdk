import { open } from 'node:fs/promises';

export const redirectUrl = 'http://127.0.0.1:49191/callback';
export const maxLoginInputBytes = 32768;
const invalidInput = 'Invalid sign-in code. Copy the complete code from the approval page.';

export function callbackDestination(url: URL): boolean {
  return url.origin === 'http://127.0.0.1:49191' && url.pathname === '/callback' && !url.username && !url.password && !url.hash;
}

export function decodeLoginInput(input: string): URL {
  if (Buffer.byteLength(input) > maxLoginInputBytes) throw new Error('Sign-in code exceeds 32 KiB.');
  const code = input.trim();
  if (!/^o11-login:[A-Za-z0-9_-]+$/.test(code)) throw new Error(invalidInput);
  const encoded = code.slice('o11-login:'.length);
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) throw new Error(invalidInput);
    const url = new URL(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!callbackDestination(url) || url.searchParams.has('error') || !url.searchParams.get('code') || !url.searchParams.get('state') || !url.searchParams.get('iss')) throw new Error(invalidInput);
    for (const key of ['code', 'state', 'iss']) if (url.searchParams.getAll(key).length > 1) throw new Error(invalidInput);
    return url;
  } catch { throw new Error(invalidInput); }
}

export async function readLoginInput(path: string): Promise<string> {
  let input = '';
  const file = path === '-' ? undefined : await open(path, 'r');
  try {
    const stream = file ? file.createReadStream() : process.stdin;
    for await (const chunk of stream) {
      input += String(chunk);
      if (Buffer.byteLength(input) > maxLoginInputBytes) throw new Error('Sign-in code exceeds 32 KiB.');
    }
    return input;
  } finally { await file?.close(); }
}

export async function submitLoginInput(input: string) {
  const url = decodeLoginInput(input);
  let response: Response;
  try { response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) }); }
  catch { throw new Error('No waiting login could receive this code. Start o11 login --no-browser in this environment and approve the new sign-in request.'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('The waiting login rejected this code. Use the code for its current sign-in request, or restart login and approve a new request.');
  }
  await response.body?.cancel();
  return { received: true, message: 'Sign-in code received. Check the waiting login command for completion.' };
}
