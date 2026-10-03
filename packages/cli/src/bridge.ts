import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Client } from '@modelcontextprotocol/client';
import { version } from './client';
export async function bridge(client: Client) {
  const server = new McpServer({ name: 'o11', version }, { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: 'Start with o11_setup. This bridge uses the same workspace permissions and mutation receipts as remote o11 MCP.' });
  server.server.setRequestHandler('tools/list', ({ params }) => client.listTools(params));
  server.server.setRequestHandler('tools/call', ({ params }) => client.callTool(params));
  server.server.setRequestHandler('resources/list', ({ params }) => client.listResources(params));
  server.server.setRequestHandler('resources/read', ({ params }) => client.readResource(params));
  server.server.setRequestHandler('prompts/list', ({ params }) => client.listPrompts(params));
  server.server.setRequestHandler('prompts/get', ({ params }) => client.getPrompt(params));
  const stdio = new StdioServerTransport();
  await server.connect(stdio);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await server.close(); await client.close(); };
  process.stdin.once('end', () => void close());
  process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
}
