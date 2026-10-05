import { auth, extractWWWAuthenticateParams, UnauthorizedError, type AuthProvider } from '@modelcontextprotocol/client';
import type { CliAuth } from './vault';

export function coordinatedAuth(provider: CliAuth, timeoutMs = 20_000): AuthProvider {
  let sentAccessToken: string | undefined;
  return {
    async token() {
      await provider.load();
      sentAccessToken = provider.tokens()?.access_token;
      return sentAccessToken;
    },
    async onUnauthorized(ctx) {
      const rejected = sentAccessToken;
      await provider.exclusive(async () => {
        await provider.load();
        const current = provider.tokens()?.access_token;
        if (current && current !== rejected) return; // Another process already refreshed; retry once.
        const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(ctx.response);
        const timeout = AbortSignal.timeout(timeoutMs);
        const fetchFn: typeof ctx.fetchFn = (input, init) => ctx.fetchFn(input, {
          ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        });
        if (await auth(provider, { serverUrl: ctx.serverUrl, resourceMetadataUrl, scope, fetchFn }) !== 'AUTHORIZED') throw new UnauthorizedError();
      });
    },
  };
}
