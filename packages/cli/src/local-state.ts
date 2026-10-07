import { constants } from 'node:fs';
import { open, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readPrivateJson(path: string): Promise<unknown | undefined> {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())) || stat.size > 8 * 1024 * 1024) throw new Error('Local state must be a private regular file owned by this user of at most 8 MiB.');
    return JSON.parse(await file.readFile('utf8')) as unknown;
  } finally { await file.close(); }
}
export async function writePrivateJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); }
  catch (error) { await file.close(); await unlink(temporary); throw error; }
  await file.close();
  try { await rename(temporary, path); } catch (error) { await unlink(temporary); throw error; }
}
