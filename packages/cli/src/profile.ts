import { mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { withProfileLock } from './credential-lock';
export const profileName = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).refine(name => name !== '__proto__', 'Choose a different profile name.');
export const credentialMode = z.enum(['keyring', 'file']);
export type CredentialMode = z.infer<typeof credentialMode>;
const profilesSchema = z.record(z.string(), z.object({ server: z.string().url(), credentialStore: credentialMode.optional() }));
export const configRoot = () => process.env.O11_CONFIG_DIR ?? join(homedir(), '.config', 'o11');
export function serverUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Use a valid HTTPS MCP URL. HTTP is allowed only on loopback."); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Use an HTTPS API URL. HTTP is allowed only on loopback.');
  // Preserve credential identities: HTTP and optional MCP share one protected resource.
  if (['/', '/api/agent/v1', '/api/agent/v1/'].includes(url.pathname)) url.pathname = '/api/mcp';
  return url;
}
async function profiles() {
  try { return profilesSchema.parse(JSON.parse(await readFile(join(configRoot(), 'profiles.json'), 'utf8'))); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}; throw error; }
}
export async function loadServer(profile: string, override?: string) {
  profileName.parse(profile);
  const server = override ?? process.env.O11_SERVER ?? (await profiles())[profile]?.server;
  if (!server) throw new Error('Run o11 login --server https://YOUR_API first.');
  return serverUrl(server);
}
export async function loadCredentialMode(profile: string, server: URL, override?: string): Promise<CredentialMode> {
  if (override !== undefined) return credentialMode.parse(override);
  const saved = (await profiles())[profileName.parse(profile)];
  return saved?.server === server.href ? saved.credentialStore ?? 'keyring' : 'keyring';
}
export async function saveServer(profile: string, server: URL, store: CredentialMode = 'keyring') {
  profileName.parse(profile); serverUrl(server.href); credentialMode.parse(store);
  await mkdir(configRoot(), { recursive: true, mode: 0o700 });
  await withProfileLock(async () => {
    const path = join(configRoot(), 'profiles.json');
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('The profile file must be a regular file without symbolic links.');
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    const data = await profiles(); data[profile] = { server: server.href, credentialStore: store };
    const temporary = join(configRoot(), `profiles.${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(data)); await file.sync(); }
    catch (error) { await file.close(); await unlink(temporary); throw error; }
    await file.close();
    try { await rename(temporary, path); }
    catch (error) { await unlink(temporary); throw error; }
  });
}
