import { validCallback } from './login-listener';
export class LoginRelayUnavailableError extends Error {}
export type LoginFetch = (input: URL, init?: RequestInit) => Promise<Response>;

export async function remoteLoginChallenge() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  return { secret, state: `o11-remote:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}` };
}

/** The public OAuth state is a hash; only the originating host knows the poll secret. */
export async function pollLogin(server: URL, secret: string, state: string, signal: AbortSignal, fetcher: LoginFetch = fetch) {
  const endpoint = new URL('/api/auth/agent-login/poll', server);
  while (!signal.aborted) {
    const response = await fetcher(endpoint, { method: 'POST', signal, redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) });
    if (!response.ok) throw new LoginRelayUnavailableError('Automatic sign-in is unavailable on this server. Use the connection-code fallback.');
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'callback' in data && typeof data.callback === 'string') {
      const callback = new URL(data.callback);
      if (callback.searchParams.get('state') === state && callback.searchParams.has('error')) throw new Error('Sign-in was declined.');
      if (!validCallback(callback, state)) throw new Error('Invalid automatic sign-in response.');
      return callback.searchParams;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('Sign-in stopped.')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2000);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  throw new Error('Sign-in stopped.');
}
