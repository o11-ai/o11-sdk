import { Client, StreamableHTTPClientTransport, type OAuthClientProvider } from '@modelcontextprotocol/client';
export const version = '0.1.3';
export function newClient() { return new Client({ name: 'o11-cli', version }, { versionNegotiation: { mode: { pin: '2026-07-28' } } }); }
export function transport(server: URL, provider?: OAuthClientProvider, token?: string) {
  return new StreamableHTTPClientTransport(server, { authProvider: token ? undefined : provider, requestInit: token ? { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' } : { redirect: 'error' } });
}
export async function connect(server: URL, provider?: OAuthClientProvider, token?: string) {
  const client = newClient();
  try { await client.connect(transport(server, provider, token)); return client; }
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
