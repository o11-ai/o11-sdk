import { validCallback } from './login-listener';
import { setTimeout as delay } from 'node:timers/promises';
export class LoginRelayUnavailableError extends Error {}
export type LoginFetch = (input: URL, init?: RequestInit) => Promise<Response>;

export async function remoteLoginChallenge() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  return { secret, state: `o11-cli-v2:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}` };
}

/** The public OAuth state is a hash; only the originating host knows the poll secret. */
export async function pollLogin(server: URL, secret: string, state: string, signal: AbortSignal, fetcher: LoginFetch = fetch) {
  const endpoint = new URL('/api/auth/agent-login/poll', server);
  let failures = 0;
  const pause = async () => { try { await delay(2000, undefined, { signal }); } catch (error) { throw signal.aborted ? signal.reason : error; } };
  while (!signal.aborted) {
    let response: Response;
    try { response = await fetcher(endpoint, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) }); }
    catch (error) {
      if (signal.aborted) throw signal.reason;
      if (++failures > 3) throw new Error('Automatic sign-in is temporarily unavailable. Retry login after the server recovers.');
      await pause(); continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([404, 405, 501].includes(response.status)) throw new LoginRelayUnavailableError('Automatic sign-in is unavailable on this server. Use the connection-code fallback.');
      if ((response.status === 429 || response.status >= 500) && ++failures <= 3) { await pause(); continue; }
      throw new Error('Automatic sign-in could not continue. Start a new login request.');
    }
    failures = 0;
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'callback' in data && typeof data.callback === 'string') {
      const callback = new URL(data.callback);
      if (callback.searchParams.get('state') === state && callback.searchParams.has('error')) throw new Error('Sign-in was declined.');
      if (!validCallback(callback, state)) throw new Error('Invalid automatic sign-in response.');
      return callback.searchParams;
    }
    await pause();
  }
  throw signal.reason instanceof Error ? signal.reason : new Error('Sign-in stopped.');
}

/** Browser feedback never invalidates a saved, verified login on a network error. */
export async function confirmLogin(server: URL, id: string, token: string, status: 'connected' | 'failed', fetcher: LoginFetch = fetch): Promise<boolean> {
  const endpoint = new URL('/api/auth/agent-login/complete', server);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(endpoint, { method: 'POST', signal: AbortSignal.timeout(5000), redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, status }) });
      await response.body?.cancel();
      if (response.ok) return true;
      if (response.status < 500 && response.status !== 429) return false;
    } catch { /* Retry a dropped acknowledgement without repeating sign-in. */ }
  }
  return false;
}
