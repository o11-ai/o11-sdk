import type { Client } from '@modelcontextprotocol/client';
import { version } from './version';
export async function bridge(client: Client) {
  const [{ McpServer }, { serveStdio }] = await Promise.all([import('@modelcontextprotocol/server'), import('@modelcontextprotocol/server/stdio')]);
  const connection = serveStdio(() => {
    const server = new McpServer({ name: 'o11', version }, { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: 'Start with o11_setup. This bridge uses the same workspace permissions and mutation receipts as remote o11 MCP.' });
    server.server.setRequestHandler('tools/list', ({ params }) => client.listTools(params));
    server.server.setRequestHandler('tools/call', ({ params }) => client.callTool(params));
    server.server.setRequestHandler('resources/list', ({ params }) => client.listResources(params));
    server.server.setRequestHandler('resources/templates/list', ({ params }) => client.listResourceTemplates(params));
    server.server.setRequestHandler('resources/read', ({ params }) => client.readResource(params));
    server.server.setRequestHandler('prompts/list', ({ params }) => client.listPrompts(params));
    server.server.setRequestHandler('prompts/get', ({ params }) => client.getPrompt(params));
    return server;
  });
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await connection.close(); await client.close(); };
  process.stdin.once('end', () => void close());
  process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
}
