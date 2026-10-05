import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { configRoot, profileName, type CredentialMode } from './profile';

const code = (error: unknown, expected: string) => error instanceof Error && 'code' in error && error.code === expected;
const privateDirectory = async (path: string) => {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid?.()))) throw new Error('Credential coordination directory must be private and owned by this user.');
  return stat;
};
export class CredentialBusyError extends Error {
  constructor() { super('Another command is updating this login. Wait for it to finish, then retry. A live owner is never force-unlocked.'); }
}
const lockRoot = (mode: CredentialMode) => mode === 'keyring' ? join(homedir(), '.config', 'o11') : configRoot();
export function credentialLockPath(profile: string, server: URL, mode: CredentialMode) {
  profileName.parse(profile);
  const hash = createHash('sha256').update(JSON.stringify([profile, server.href, mode])).digest('hex');
  return join(lockRoot(mode), 'credential-locks', hash);
}
export async function withCredentialLock<T>(profile: string, server: URL, mode: CredentialMode, action: () => Promise<T>, options: { waitMs?: number; orphanMs?: number } = {}): Promise<T> {
  const directory = join(lockRoot(mode), 'credential-locks');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await privateDirectory(directory);
  const path = credentialLockPath(profile, server, mode);
  const owner = `${process.pid}-${randomUUID()}.owner`;
  const deadline = Date.now() + (options.waitMs ?? 30_000);
  // Publish an already populated directory atomically: no empty acquisition window
  // lets a delayed dead-owner reaper remove a newly acquired claim.
  const prepared = await mkdtemp(`${path}.claim-`);
  const file = await open(join(prepared, owner), 'wx', 0o600);
  await file.close();
  try {
    for (;;) {
      let acquired = false;
      try { await rename(prepared, path); acquired = true; }
      catch (error) {
        if (!code(error, 'EEXIST') && !code(error, 'ENOTEMPTY')) throw error;
      }
      if (acquired) {
        try { return await action(); }
        finally {
          // A unique filename prevents an old owner/reaper from deleting a new owner's claim.
          await unlink(join(path, owner)).catch(error => { if (!code(error, 'ENOENT')) throw error; });
          await rmdir(path).catch(error => { if (!code(error, 'ENOENT') && !code(error, 'ENOTEMPTY')) throw error; });
        }
      }
      try {
        const stat = await privateDirectory(path);
        const entries = await readdir(path);
        if (entries.length === 0) {
          if (Date.now() - stat.mtimeMs >= (options.orphanMs ?? 2_000)) {
            // rmdir only removes an empty directory. A new owner file makes this fail safely.
            await rmdir(path).catch(error => { if (!code(error, 'ENOENT') && !code(error, 'ENOTEMPTY')) throw error; });
          }
        } else {
          if (entries.length !== 1 || !/^[1-9]\d*-[a-f0-9-]{36}\.owner$/.test(entries[0]!)) throw new Error('Invalid credential coordination owner. Inspect local state before retrying.');
          const filename = entries[0]!;
          const ownerStat = await lstat(join(path, filename));
          if (ownerStat.isSymbolicLink() || !ownerStat.isFile() || (process.platform !== 'win32' && ((ownerStat.mode & 0o077) || ownerStat.uid !== process.getuid?.()))) throw new Error('Invalid credential coordination owner permissions.');
          let dead = false;
          try { process.kill(Number(filename.split('-')[0]), 0); }
          catch (error) { if (code(error, 'ESRCH')) dead = true; else if (!code(error, 'EPERM')) throw error; }
          if (dead) {
            // Only the reaper that removed this exact stale claim attempts rmdir.
            try { await unlink(join(path, filename)); await rmdir(path); }
            catch (error) { if (!code(error, 'ENOENT') && !code(error, 'ENOTEMPTY')) throw error; }
          }
        }
      } catch (error) { if (!code(error, 'ENOENT')) throw error; }
      if (Date.now() >= deadline) throw new CredentialBusyError();
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  } finally { await rm(prepared, { recursive: true, force: true }); }
}
