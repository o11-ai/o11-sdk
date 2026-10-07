import type { Client, AuthProvider, OAuthClientProvider } from '@modelcontextprotocol/client';
import { version } from './version';
export { version } from './version';
export async function newClient() { const { Client } = await import('@modelcontextprotocol/client'); return new Client({ name: 'o11-cli', version }, { versionNegotiation: { mode: { pin: '2026-07-28' } } }); }
export async function transport(server: URL, provider?: OAuthClientProvider | AuthProvider, token?: string) {
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  return new StreamableHTTPClientTransport(server, { authProvider: token ? undefined : provider, requestInit: token ? { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' } : { redirect: 'error' } });
}
export async function connect(server: URL, provider?: OAuthClientProvider | AuthProvider, token?: string) {
  const client = await newClient();
  try { await client.connect(await transport(server, provider, token)); return client; }
  catch (error) { await client.close(); throw error; }
}
export async function allTools(client: Client) {
  const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
  const seen = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools); cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Server returned a repeated tool cursor.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return tools;
}
