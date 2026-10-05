import { CliAuth, credentialStore } from './vault';
import { newClient, transport } from './client';
import { saveServer, type CredentialMode } from './profile';
import { auth } from '@modelcontextprotocol/client';
import { redirectUrl } from './login-input';
import { openLoginBrowser } from './login-browser';
import { startLoginListener } from './login-listener';
export { redirectUrl } from './login-input';
export { validCallback } from './login-listener';
export async function login(server: URL, profile: string, scope?: string, options: { credentialStore?: CredentialMode; noBrowser?: boolean } = {}) {
  if (scope && scope.split(/\s+/).some(item => !['o11:read', 'o11:configure', 'o11:credentials', 'o11:publish', 'o11:send'].includes(item))) throw new Error('Unknown scope.');
  const provider = await new CliAuth(redirectUrl, await credentialStore(profile, server, options.credentialStore), url => openLoginBrowser(url, options.noBrowser), scope).load();
  // Explicit login may be requesting additional consent; do not reuse the old token.
  await provider.invalidateCredentials('tokens');
  const listener = await startLoginListener(() => provider.lastState);
  const client = newClient(), initial = transport(server, provider);
  try {
    // Explicit login must request consent even when unauthenticated discovery
    // succeeds, rather than waiting for a connect-time 401.
    const status = await auth(provider, { serverUrl: server, scope: scope ?? provider.clientMetadata.scope });
    if (status === 'REDIRECT') await initial.finishAuth(await listener.callback);
    await client.connect(transport(server, provider));
    const setup = await client.callTool({ name: 'o11_setup', arguments: {} });
    if (setup.isError) throw new Error('Sign-in succeeded but workspace setup is unavailable.');
    await saveServer(profile, server, options.credentialStore);
    return setup;
  } finally { await listener.close(); await client.close(); }
}
