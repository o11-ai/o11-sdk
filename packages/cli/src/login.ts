import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { CliAuth, systemStore } from './vault';
import { newClient, transport } from './client';
import { saveServer } from './profile';
import { auth } from '@modelcontextprotocol/client';
export const redirectUrl = 'http://127.0.0.1:49191/callback';
export function validCallback(url: URL, state: string | undefined): boolean { return !!state && url.origin === 'http://127.0.0.1:49191' && url.pathname === '/callback' && url.searchParams.get('state') === state && !!url.searchParams.get('code') && !url.searchParams.has('error'); }
function openBrowser(url: URL) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url.href] : [url.href];
  return new Promise<void>(resolve => { execFile(command, args, error => { if (error) process.stderr.write(`Open this sign-in link in your browser:\n${url.href}\n`); resolve(); }); });
}
export async function login(server: URL, profile: string, scope?: string) {
  if (scope && scope.split(/\s+/).some(item => !['o11:read', 'o11:configure', 'o11:credentials', 'o11:publish', 'o11:send'].includes(item))) throw new Error('Unknown scope.');
  const provider = await new CliAuth(redirectUrl, await systemStore(profile, server), openBrowser, scope).load();
  // Explicit login may be requesting additional consent; do not reuse the old token.
  await provider.invalidateCredentials('tokens');
  let resolveCallback: (params: URLSearchParams) => void = () => {};
  let rejectCallback: (error: Error) => void = () => {};
  const callback = new Promise<URLSearchParams>((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
  const listener = createServer((req, res) => {
    const url = new URL(req.url ?? '/', redirectUrl);
    if (req.method === 'GET' && req.headers.host === '127.0.0.1:49191' && url.origin === 'http://127.0.0.1:49191' && url.pathname === '/callback' && provider.lastState && url.searchParams.get('state') === provider.lastState && url.searchParams.has('error')) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Sign-in was not completed. Return to your agent.'); rejectCallback(new Error('Sign-in was declined. Run o11 login when ready.')); return;
    }
    if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:49191' || !validCallback(url, provider.lastState)) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Invalid sign-in response. Return to your terminal.'); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Sign-in received. Return to your agent to continue.'); resolveCallback(url.searchParams);
  });
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(49191, '127.0.0.1', resolve); });
  const timeout = setTimeout(() => rejectCallback(new Error('Sign-in timed out. Run o11 login again.')), 300000);
  // Attach a rejection handler before connecting, which may fail without awaiting callback.
  void callback.catch(() => {});
  const client = newClient(), initial = transport(server, provider);
  try {
    // Explicit login must request consent even when unauthenticated discovery
    // succeeds, rather than waiting for a connect-time 401.
    const status = await auth(provider, { serverUrl: server, scope: scope ?? provider.clientMetadata.scope });
    if (status === 'REDIRECT') await initial.finishAuth(await callback);
    await client.connect(transport(server, provider));
    const setup = await client.callTool({ name: 'o11_setup', arguments: {} });
    if (setup.isError) throw new Error('Sign-in succeeded but workspace setup is unavailable.');
    await saveServer(profile, server);
    return setup;
  } finally { clearTimeout(timeout); listener.closeAllConnections(); listener.close(); await client.close(); }
}
