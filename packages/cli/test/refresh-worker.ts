import { CliAuth, credentialStore } from '../src/vault';
import { withCredentialLock } from '../src/credential-lock';
const [mode, endpoint] = process.argv.slice(2);
const server = new URL(endpoint!);
if (mode === 'hold') {
  await withCredentialLock('qa-race', server, 'file', async () => {
    console.log('locked');
    await new Promise<void>(() => {});
  });
} else {
  const provider = await new CliAuth('http://127.0.0.1:49191/callback', await credentialStore('qa-race', server, 'file'), async () => { throw new Error('Explicit sign-in required.'); }).load();
  const adapter = provider.transportAuth();
  const original = await adapter.token();
  await fetch(new URL('/barrier', server)); // Both independent processes loaded the expired token.
  await adapter.onUnauthorized!({ serverUrl: server, response: new Response(null,{status:401}), fetchFn:fetch });
  console.log(JSON.stringify({refreshed:await adapter.token() !== original}));
}
