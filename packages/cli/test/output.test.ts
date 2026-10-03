import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callWithOutput } from '../src/output';

test('a private output is reserved before a mutation and never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-cli-output-'));
  const path = join(dir, 'receipt.json'); let calls = 0;
  try {
    await writeFile(path, 'original');
    await expect(callWithOutput(async () => { calls++; return { token: 'secret' }; }, path)).rejects.toThrow();
    expect(calls).toBe(0); expect(await readFile(path, 'utf8')).toBe('original');
    await rm(path);
    await callWithOutput(async () => { calls++; return { token: 'secret' }; }, path);
    expect(calls).toBe(1); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ token: 'secret' });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
