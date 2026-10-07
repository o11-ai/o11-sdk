import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
export async function serviceToken() {
  const direct = process.env.O11_TOKEN, path = process.env.O11_TOKEN_FILE;
  if (direct && path) throw new Error('Set only one of O11_TOKEN or O11_TOKEN_FILE.');
  if (!path) return direct || undefined;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 65536 || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw new Error('O11_TOKEN_FILE must be a private regular file owned by this user, at most 64 KiB.');
    const token = (await file.readFile('utf8')).trim();
    if (!token || /\s/.test(token)) throw new Error('O11_TOKEN_FILE must contain one nonempty token.');
    return token;
  } finally { await file.close(); }
}
