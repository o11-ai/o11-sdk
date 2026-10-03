import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
export const profileName = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const profilesSchema = z.record(z.string(), z.object({ server: z.string().url() }));
const configRoot = () => process.env.O11_CONFIG_DIR ?? join(homedir(), '.config', 'o11');
export function serverUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Use an HTTPS MCP URL. HTTP is allowed only on loopback.');
  return url;
}
async function profiles() {
  try { return profilesSchema.parse(JSON.parse(await readFile(join(configRoot(), 'profiles.json'), 'utf8'))); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}; throw error; }
}
export async function loadServer(profile: string, override?: string) {
  profileName.parse(profile);
  const server = override ?? process.env.O11_SERVER ?? (await profiles())[profile]?.server;
  if (!server) throw new Error('Run o11 login --server YOUR_MCP_URL first.');
  return serverUrl(server);
}
export async function saveServer(profile: string, server: URL) {
  const data = await profiles(); data[profileName.parse(profile)] = { server: server.href };
  await mkdir(configRoot(), { recursive: true, mode: 0o700 });
  await writeFile(join(configRoot(), 'profiles.json'), JSON.stringify(data), { mode: 0o600 });
}
