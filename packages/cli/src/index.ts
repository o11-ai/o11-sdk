#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { callWithOutput } from './output';
import { CliAuth, credentialStore } from './vault';
import { loadServer, loadCredentialMode } from './profile';
import { connect, allTools, version } from './client';
import { login, redirectUrl } from './login';
import { readLoginInput, submitLoginInput } from './login-input';
import { bridge } from './bridge';
import { agentDocs, readDoc } from './docs.js';
const options = { server: { type: 'string' }, profile: { type: 'string', default: 'default' }, input: { type: 'string' }, search: { type: 'string' }, scope: { type: 'string' }, 'no-browser': { type: 'boolean' }, 'credential-store': { type: 'string' }, 'operation-id': { type: 'string' }, 'output-file': { type: 'string' }, help: { type: 'boolean' }, version: { type: 'boolean' } } as const;
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
export async function run(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const [command, name] = positionals;
  if (values.version) { print({ version }); return; }
  if (!command || values.help) { print({ commands: ['login --server URL [--scope "o11:read o11:configure o11:credentials"] [--credential-store keyring|file] [--no-browser]', 'login --input FILE|- (complete a waiting login with the copied sign-in code)', 'status', 'tools list [--search TEXT]', 'tools describe TOOL', 'call TOOL --input FILE|- [--operation-id UUID] [--output-file FILE]', 'docs [PAGE]', 'mcp', 'logout'], options: ['--profile NAME', '--server URL', '--credential-store keyring|file'], credentials: 'OS keyring by default; private local files only when explicitly selected. O11_TOKEN accepts a scoped key. Never put credentials in arguments.' }); return; }
  if (command === 'docs') { const doc = name ? readDoc(name) : undefined; if (name && !doc) throw new Error('Unknown documentation page. Run o11 docs.'); print(doc ?? agentDocs.map(({ markdown: _, ...doc }) => doc)); return; }
  if (command === 'login' && values.input !== undefined) {
    if (name || values.scope || values.server || values['no-browser'] || values['credential-store']) throw new Error('Use login --input FILE|- by itself to complete the waiting login.');
    print(await submitLoginInput(await readLoginInput(values.input))); return;
  }
  const server = await loadServer(values.profile, values.server);
  const mode = await loadCredentialMode(values.profile, server, values['credential-store']);
  if (command === 'login') { print(await login(server, values.profile, values.scope, { credentialStore: mode, noBrowser: values['no-browser'] })); return; }
  if (command === 'logout') { await (await credentialStore(values.profile, server, mode)).clear(); print({ loggedOut: true }); return; }
  const token = process.env.O11_TOKEN;
  const provider = token ? undefined : await new CliAuth(redirectUrl, await credentialStore(values.profile, server, mode), async () => { throw new Error('Sign-in or additional consent is required. Run o11 login.'); }).load();
  const client = await connect(server, provider, token);
  if (command === 'mcp') { await bridge(client); return; }
  try {
    if (command === 'status') { const result = await client.callTool({ name: 'o11_setup', arguments: {} }); print(result); if (result.isError) process.exitCode = 1; return; }
    if (command === 'tools') {
      const tools = await allTools(client);
      if (name === 'describe') { const tool = tools.find(item => item.name === positionals[2]?.replaceAll('.', '_')); if (!tool) throw new Error('Tool unavailable. Check o11 tools list and permissions.'); print(tool); }
      else if (name === 'list' || !name) print(tools.filter(tool => !values.search || `${tool.name} ${tool.description}`.toLowerCase().includes(values.search.toLowerCase())).map(({ name, description }) => ({ name, description })));
      else throw new Error('Use tools list or tools describe TOOL.');
      return;
    }
    if (command !== 'call' || !name) throw new Error('Unknown command. Run o11 --help.');
    let raw = '{}';
    if (values.input === '-') { raw = ''; for await (const chunk of process.stdin) { raw += String(chunk); if (Buffer.byteLength(raw) > 1048576) throw new Error('Input exceeds 1 MiB.'); } }
    else if (values.input) raw = await readFile(values.input, 'utf8');
    if (Buffer.byteLength(raw) > 1048576) throw new Error('Input exceeds 1 MiB.');
    const args: unknown = JSON.parse(raw);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Input must be a JSON object.');
    const input = args as Record<string, unknown>;
    if (values['operation-id']) { if (input._operationId && input._operationId !== values['operation-id']) throw new Error('Conflicting operation IDs.'); input._operationId = values['operation-id']; }
    const result = await callWithOutput(() => client.callTool({ name: name.replaceAll('.', '_'), arguments: input }), values['output-file']);
    if (values['output-file']) { print({ saved: values['output-file'], isError: result.isError ?? false }); }
    else print(result);
    if (result.isError) process.exitCode = 1;
  } finally { await client.close(); }
}
await run(process.argv.slice(2)).catch(error => { print({ error: error instanceof Error ? error.message : 'Request failed.', recovery: 'Inspect operation status and saved state before retrying a mutation.' }); process.exitCode = 1; });
