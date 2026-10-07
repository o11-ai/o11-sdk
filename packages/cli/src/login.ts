import { CliAuth, credentialStore, LoginRequiredError } from './vault';
import { ApiClient, ApiError } from './http-client';
import { saveServer, type CredentialMode } from './profile';
import { redirectUrl } from './login-input';
import { openLoginBrowser } from './login-browser';
import { startLoginListener } from './login-listener';
import { withLoginCredentials } from './login-credentials';
import { LoginRelayUnavailableError, pollLogin, remoteLoginChallenge } from './login-relay';
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
        return setup;
      } catch (error) {
        // Keep refresh outages distinct from consent failures masked by the API client.
        error = authenticationError ?? error;
        if (!(error instanceof LoginRequiredError || error instanceof UnauthorizedError || (error instanceof ApiError && [401, 403].includes(error.status)))) throw error;
      }
    }
  }
  return store.exclusive!(async () => {
    const setup = await withLoginCredentials(store, async pending => {
    const relay = options.noBrowser ? await remoteLoginChallenge() : undefined;
    const provider = await new CliAuth(redirectUrl, pending, url => openLoginBrowser(url, options.noBrowser), scope, relay?.state).load();
    // New consent and --reauth must not reuse the old token.
    await provider.invalidateCredentials('tokens');
    const listener = await startLoginListener(() => provider.lastState);
    const abort = new AbortController();
    try {
      // Explicit login must request consent even when unauthenticated discovery
      // succeeds, rather than waiting for a connect-time 401.
      const status = await auth(provider, { serverUrl: server, scope: scope ?? provider.clientMetadata.scope });
      if (status === 'REDIRECT') {
        const callback = relay ? await Promise.race([listener.callback, pollLogin(server, relay.secret, relay.state, abort.signal).catch(error => {
          if (error instanceof LoginRelayUnavailableError) return listener.callback;
          throw error;
        })]) : await listener.callback;
        const completed = await auth(provider, { serverUrl: server, authorizationCode: callback.get('code')!, iss: callback.get('iss') ?? undefined });
        if (completed !== 'AUTHORIZED') throw new Error('Sign-in did not complete. Run o11 login again.');
      }
      const setup = await new ApiClient(server, undefined, provider.tokens()?.access_token).request('status');
      return setup;
    } finally { abort.abort(); await listener.close(); }
    });
    await saveServer(profile, server, options.credentialStore);
    return setup;
  });
}
