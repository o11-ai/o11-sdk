import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function assertPublicText(text: string, label: string) {
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/,
    /(?:\/Users\/|\/home\/)[^\s"<>]+/,
    /(?:o11[-]monorepo|\/apps\/(?:backend|web-retention)|\/\.git\/|\/\.agents\/)/,
    /sourceMappingURL\s*=|"sourcesContent"\s*:/,
  ];
  if (forbidden.some(pattern => pattern.test(text))) throw new Error(`Private material or source map in ${label}.`);
}
export async function publicFiles(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, prefix))) {
    const path = prefix ? `${prefix}/${entry}` : entry;
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Symlink forbidden in public output: ${path}`);
    if (stat.isDirectory()) result.push(...await publicFiles(root, path));
    else if (stat.isFile()) result.push(path);
    else throw new Error(`Unsupported public file: ${path}`);
  }
  return result;
}

export async function assertPackageOutput(root: string, allowed: readonly string[]) {
  const files = await publicFiles(root);
  if (files.length !== allowed.length || files.some(path => !allowed.includes(path))) throw new Error('Package output differs from the reviewed file allowlist.');
  for (const path of files) assertPublicText(await readFile(join(root, path), 'utf8'), path);
}
