import { CliAuth, credentialStore, LoginRequiredError } from './vault';
import { ApiClient, ApiError } from './http-client';
import { saveServer, type CredentialMode } from './profile';
import { redirectUrl } from './login-input';
import { openLoginBrowser } from './login-browser';
import { startLoginListener } from './login-listener';
import { withLoginCredentials } from './login-credentials';
import { LoginRelayUnavailableError, pollLogin, remoteLoginChallenge, confirmLogin } from './login-relay';
import { createHash } from 'node:crypto';
import { authenticatedResult } from './auth-result';
import type { AuthOptions } from '@modelcontextprotocol/client';
export { redirectUrl } from './login-input';
export { validCallback } from './login-listener';
export async function login(server: URL, profile: string, scope?: string, options: { credentialStore?: CredentialMode; noBrowser?: boolean; reauth?: boolean } = {}) {
  const { auth, UnauthorizedError } = await import('@modelcontextprotocol/client');
  if (scope !== undefined) {
    const scopes = scope.trim().split(/\s+/);
    if (scopes.some(item => !['o11:read', 'o11:configure', 'o11:credentials', 'o11:publish', 'o11:send'].includes(item))) throw new Error('Unknown or empty scope.');
    scope = [...new Set(scopes)].join(' ');
  }
  const store = await credentialStore(profile, server, options.credentialStore);
  if (!options.reauth) {
    const existing = await new CliAuth(redirectUrl, store, async () => { throw new LoginRequiredError(); }).load();
    const tokens = existing.tokens();
    const granted = new Set(tokens?.scope?.split(/\s+/));
    if (tokens && (!scope || scope.split(' ').every(item => granted.has(item)))) {
      const transport = existing.transportAuth();
      let authenticationError: unknown;
      const onUnauthorized = transport.onUnauthorized;
      transport.onUnauthorized = async context => {
        try { await onUnauthorized?.(context); }
        catch (error) { authenticationError = error; throw error; }
      };
      try {
        const setup = await new ApiClient(server, transport).request('status');
        await saveServer(profile, server, options.credentialStore);
        return authenticatedResult(setup, profile, 'file');
      } catch (error) {
        // Keep refresh outages distinct from consent failures masked by the API client.
        error = authenticationError ?? error;
        if (!(error instanceof LoginRequiredError || error instanceof UnauthorizedError || (error instanceof ApiError && [401, 403].includes(error.status)))) throw error;
      }
    }
  }
  return store.exclusive!(async () => {
    const relay = await remoteLoginChallenge();
    const abort = new AbortController();
    const stop = () => abort.abort(new Error('Sign-in stopped. Run o11 login when ready.'));
    const timeout = setTimeout(() => abort.abort(new Error('Sign-in timed out. Run o11 login again and approve the new request.')), 600_000);
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    let acknowledgement: { id: string; token: string } | undefined;
    let listener: Awaited<ReturnType<typeof startLoginListener>> | undefined;
    const fetchFn: AuthOptions['fetchFn'] = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000), ...(init?.signal ? [init.signal] : [])]) });
    try {
      const setup = await withLoginCredentials(store, async pending => {
        const provider = await new CliAuth(redirectUrl, pending, url => openLoginBrowser(url, options.noBrowser), scope, relay.state).load();
        // New consent and --reauth must not reuse the old token.
        await provider.invalidateCredentials('tokens');
        // Server handoff works even when a callback port is busy or unavailable.
        try { listener = await startLoginListener(() => provider.lastState); } catch { /* Legacy fallback is optional. */ }
        // Explicit login must request consent even when unauthenticated discovery
        // succeeds, rather than waiting for a connect-time 401.
        const status = await auth(provider, { serverUrl: server, scope: scope ?? provider.clientMetadata.scope, fetchFn });
        if (status === 'REDIRECT') {
          const remote = pollLogin(server, relay.secret, relay.state, abort.signal).catch(error => {
            if (error instanceof LoginRelayUnavailableError && listener) {
              process.stderr.write('This server needs a compatibility fallback. Use the approval page on this computer, or submit its sign-in code with o11 login --input FILE|- here.\n');
              return listener.callback;
            }
            throw error;
          });
          const cancelled = new Promise<never>((_, reject) => {
            if (abort.signal.aborted) reject(abort.signal.reason);
            else abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
          });
          const callback = await Promise.race([remote, cancelled, ...(listener ? [listener.callback] : [])]);
          abort.signal.throwIfAborted();
          const completed = await auth(provider, { serverUrl: server, authorizationCode: callback.get('code')!, iss: callback.get('iss') ?? undefined, fetchFn });
          if (completed !== 'AUTHORIZED') throw new Error('Sign-in did not complete. Run o11 login again.');
          const token = provider.tokens()?.access_token;
          if (token) acknowledgement = { id: createHash('sha256').update(callback.get('code')!).digest('hex'), token };
        }
        const setup = await new ApiClient(server, undefined, provider.tokens()?.access_token).request('status', undefined, { signal: abort.signal });
        abort.signal.throwIfAborted();
        return setup;
      });
      await saveServer(profile, server, options.credentialStore);
      if (acknowledgement && !await confirmLogin(server, acknowledgement.id, acknowledgement.token, 'connected')) process.stderr.write('Signed in successfully. Browser confirmation could not update; check o11 status and close the browser window.\n');
      return authenticatedResult(setup, profile, 'file');
    } catch (error) {
      if (acknowledgement) await confirmLogin(server, acknowledgement.id, acknowledgement.token, 'failed');
      throw error;
    } finally {
      clearTimeout(timeout); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      abort.abort(); await listener?.close();
    }
  });
}
