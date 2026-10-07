import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { configRoot } from './profile';
import { readPrivateJson, writePrivateJson } from './local-state';
import { object } from './http-client';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const directory = (server: string, profile: string) => join(configRoot(), 'discovery', hash({ server, profile }));
function identity(response: Record<string, unknown>) {
  const server = object(response.server) ? response.server : {};
  const access = object(response.access) ? response.access : {};
  return { schemaVersion: typeof server.schemaVersion === 'string' ? server.schemaVersion : null, fingerprint: typeof access.fingerprint === 'string' ? access.fingerprint : null };
}
export async function cachedDiscovery(server: string, profile: string, path: string) {
  const root = directory(server, profile);
  const current = await readPrivateJson(join(root, 'identity.json'));
  const item = current ? await readPrivateJson(join(root, hash({ path, identity: current }) + '.json')) : undefined;
  if (!object(item) || !object(item.response)) throw new Error('No cached help for this profile, server, and last observed schema/permission version. Run this command with --help while connected first.');
  return { ...item.response, cache: { offline: true, authoritative: false, checkedAt: item.checkedAt, identity: current, message: 'Cached discovery may be stale. The server checks current permissions when executing.' } };
}
export async function saveDiscovery(server: string, profile: string, path: string, response: Record<string, unknown>) {
  const root = directory(server, profile), current = identity(response);
  await writePrivateJson(join(root, hash({ path, identity: current }) + '.json'), { checkedAt: new Date().toISOString(), response });
  if (path === 'commands' || path === 'commands?all=true') {
    const result = Array.isArray(response.result) ? response.result.filter(object).filter(row => path === 'commands' ? row.available !== false : row.available === true) : [];
    await writePrivateJson(join(root, hash({ path: 'completion', identity: current }) + '.json'), { checkedAt: new Date().toISOString(), response: { ...response, result } });
  }
  await writePrivateJson(join(root, 'identity.json'), current);
}
/** Completion never loads credentials or treats cached permission data as current authorization. */
export async function cachedCommands(server: string, profile: string): Promise<string[]> {
  for (const path of ['completion', 'commands']) {
    try {
      const response: Record<string, unknown> = await cachedDiscovery(server, profile, path);
      return Array.isArray(response.result) ? response.result.filter(object).filter(row => row.available !== false).map(row => String(row.command ?? '')) : [];
    } catch { /* Missing, invalid, or obsolete cache falls back to local groups. */ }
  }
  return [];
}
export function completionScript(shell: string, discovered: string[] = []) {
  const local = 'login logout status setup check wait watch profiles commands docs routines personas surveys customers signals analytics research operations operation-id verify validate batch diagnostics install benchmark example'.split(' ');
  const commands = [...new Set([...local, ...discovered.filter(command => /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/.test(command))])];
  if (shell === 'bash') {
    const next = new Map<string, Set<string>>();
    for (const command of commands) {
      const words = command.split(' ');
      words.forEach((word, index) => { const prefix = words.slice(0, index).join(' '); if (!next.has(prefix)) next.set(prefix, new Set()); next.get(prefix)!.add(word); });
    }
    const cases = [...next].map(([prefix, words]) => `    '${prefix}') COMPREPLY=( $(compgen -W '${[...words].sort().join(' ')} --help --json --profile --input --output-file' -- "$cur") ) ;;`).join('\n');
    return `_o11_complete() {\n  local cur="\${COMP_WORDS[COMP_CWORD]}" prefix="\${COMP_WORDS[*]:1:COMP_CWORD-1}"\n  case "$prefix" in\n${cases}\n  esac\n}\ncomplete -F _o11_complete o11`;
  }
  const words = [...new Set(commands.flatMap(command => command.split(' ')))].sort();
  if (shell === 'zsh') return `#compdef o11\n_arguments '*:command:(${words.join(' ')})'`;
  if (shell === 'fish') return words.map(command => `complete -c o11 -f -a ${command}`).join('\n');
  throw new Error('Supported completion shells: bash, zsh, fish.');
}
