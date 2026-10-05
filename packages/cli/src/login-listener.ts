import { createServer } from 'node:http';
import { callbackDestination, redirectUrl } from './login-input';

export function validCallback(url: URL, state: string | undefined): boolean {
  return !!state && callbackDestination(url) && url.searchParams.getAll('state').length === 1 && url.searchParams.get('state') === state && url.searchParams.getAll('code').length === 1 && !!url.searchParams.get('code') && url.searchParams.getAll('iss').length <= 1 && !url.searchParams.has('error');
}

export async function startLoginListener(state: () => string | undefined) {
  let settled = false;
  let resolveCallback: (params: URLSearchParams) => void = () => {};
  let rejectCallback: (error: Error) => void = () => {};
  const callback = new Promise<URLSearchParams>((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
  void callback.catch(() => {});
  const listener = createServer((req, res) => {
    let url: URL;
    try { url = new URL(req.url ?? '/', redirectUrl); }
    catch { res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Invalid sign-in response. Return to your terminal.'); return; }
    const expectedState = state();
    const localRequest = !settled && req.method === 'GET' && req.headers.host === '127.0.0.1:49191' && callbackDestination(url);
    if (localRequest && expectedState && url.searchParams.getAll('state').length === 1 && url.searchParams.get('state') === expectedState && url.searchParams.has('error')) {
      settled = true; res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Sign-in was not completed. Return to your agent.'); rejectCallback(new Error('Sign-in was declined. Run o11 login when ready.')); return;
    }
    if (!localRequest || !validCallback(url, expectedState)) { res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Invalid sign-in response. Return to your terminal.'); return; }
    settled = true; res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Sign-in received. Return to your agent to continue.'); resolveCallback(url.searchParams);
  });
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(49191, '127.0.0.1', resolve); });
  const timeout = setTimeout(() => { if (!settled) { settled = true; rejectCallback(new Error('Sign-in timed out. Run o11 login again and approve the new request.')); } }, 600000);
  return { callback, close: async () => { settled = true; clearTimeout(timeout); await new Promise<void>((resolve, reject) => { listener.close(error => error ? reject(error) : resolve()); listener.closeAllConnections(); }); } };
}
