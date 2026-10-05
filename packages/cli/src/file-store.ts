import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { configRoot, profileName } from './profile';
import type { SecretStore } from './vault';

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
export async function fileStore(profile: string, server: URL): Promise<SecretStore> {
  profileName.parse(profile);
  if (process.platform === 'win32') throw new Error('File credentials require POSIX file permissions. Use the OS keyring on Windows.');
  const directory = join(configRoot(), 'credentials');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const privateFile = (stat: Stats, directory = false) => {
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) {
      throw new Error('The credential store must be owned by this user, private, and free of symbolic links.');
    }
  };
  const checkDirectory = async () => privateFile(await lstat(directory), true);
  await checkDirectory();
  const hash = createHash('sha256').update(JSON.stringify([profile, server.href])).digest('hex');
  const path = join(directory, `${hash}.json`);
  const checkFile = async () => { try { privateFile(await lstat(path)); } catch (error) { if (!missing(error)) throw error; } };
  return {
    async read() {
      await checkDirectory(); await checkFile();
      let file: Awaited<ReturnType<typeof open>>;
      try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if (missing(error)) return null; throw error; }
      try { privateFile(await file.stat()); return await file.readFile('utf8'); }
      finally { await file.close(); }
    },
    async write(value) {
      await checkDirectory(); await checkFile();
      const temporary = join(directory, `${hash}.${randomUUID()}.tmp`);
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(value); await file.sync(); }
      catch (error) { await file.close(); await unlink(temporary); throw error; }
      await file.close();
      try { await rename(temporary, path); }
      catch (error) { await unlink(temporary); throw error; }
    },
    async clear() {
      await checkDirectory(); await checkFile();
      try { await unlink(path); } catch (error) { if (!missing(error)) throw error; }
    },
  };
}
