import type { AuthProvider } from '@modelcontextprotocol/client';
import type { CliAuth } from './vault';

export class AuthenticationTransportError extends Error {
  constructor(readonly status = 0, timedOut = false) {
    super(timedOut
      ? 'Timed out while authenticating. Retry this command; your saved login is retained.'
      : status === 429 || status >= 500
      ? 'Authentication is temporarily unavailable. Retry this command; your saved login is retained.'
      : 'Authentication transport failed. Retry this command; your saved login is retained.');
  }
}

export function coordinatedAuth(provider: CliAuth, timeoutMs = 20_000): AuthProvider {
  let sentAccessToken: string | undefined;
  return {
    async token() {
      await provider.load();
      sentAccessToken = provider.tokens()?.access_token;
      return sentAccessToken;
    },
    async onUnauthorized(ctx) {
      const { auth, extractWWWAuthenticateParams, UnauthorizedError } = await import('@modelcontextprotocol/client');
      const rejected = sentAccessToken;
      await provider.exclusive(async () => {
        await provider.load();
        const current = provider.tokens()?.access_token;
        if (current && current !== rejected) return; // Another process already refreshed; retry once.
        const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(ctx.response);
        const timeout = AbortSignal.timeout(timeoutMs);
        let transportFailure: Error | undefined;
        const fetchFn: typeof ctx.fetchFn = async (input, init) => {
          try {
            const response = await ctx.fetchFn(input, {
              ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
            });
            if (response.status === 429 || response.status >= 500) transportFailure = new AuthenticationTransportError(response.status);
            return response;
          } catch (error) {
            transportFailure = error instanceof AuthenticationTransportError ? error : new AuthenticationTransportError(0, timeout.aborted);
            throw transportFailure;
          }
        };
        try {
          if (await auth(provider, { serverUrl: ctx.serverUrl, resourceMetadataUrl, scope, fetchFn }) !== 'AUTHORIZED') throw new UnauthorizedError();
        } catch (error) {
          // The SDK can fall back to authorization after a network failure.
          // An outage must not become an instruction to sign in again.
          throw transportFailure ?? error;
        }
      });
    },
  };
}
