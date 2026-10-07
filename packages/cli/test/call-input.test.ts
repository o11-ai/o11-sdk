import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCallInput } from '../src/call-input';

test('JSON errors never echo credential-bearing input; bounded reads preserve Unicode and operation IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'o11-call-input-'));
  const path = join(root, 'input.json');
  try {
    await writeFile(path, '{"credential": secret-value}');
    await expect(readCallInput(path)).rejects.toThrow('Input must be valid JSON.');
    const id = crypto.randomUUID();
    await writeFile(path, JSON.stringify({ name: '日本語', _operationId: id }));
    expect(await readCallInput(path, id)).toEqual({ name: '日本語', _operationId: id });
    await expect(readCallInput(path, crypto.randomUUID())).rejects.toThrow('Conflicting');
    await expect(readCallInput(path, 'invalid')).rejects.toThrow('UUID');
    await writeFile(path, JSON.stringify({ _operationId: null }));
    await expect(readCallInput(path, id)).rejects.toThrow('Conflicting');
    await writeFile(path, 'x'.repeat(1048577));
    await expect(readCallInput(path)).rejects.toThrow('1 MiB');
    expect((await readFile(path)).length).toBe(1048577);
    await writeFile(path, '[]');
    await expect(readCallInput(path)).rejects.toThrow('JSON object');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid commands and invalid call input fail locally before login or network access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'o11-local-errors-'));
  const path = join(root, 'input.json');
  await writeFile(path, '{"credential": secret-value}');
  try {
    const cases = [
      { args: ['mistyped'], error: 'Unknown command' },
      { args: ['tools', 'describe'], error: 'Use tools list' },
      { args: ['call', 'tool', 'extra'], error: 'Unexpected command arguments' },
      { args: ['status', '--scope', 'o11:publish'], error: 'available only for login' },
      { args: ['call', 'tool', '--input', path], error: 'Input must be valid JSON' },
    ];
    for (const { args, error } of cases) {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL('../src/index.ts', import.meta.url)), ...args], { env: { ...process.env, O11_CONFIG_DIR: root, O11_SERVER: '' }, stdout: 'pipe', stderr: 'pipe' });
      const output = await new Response(child.stderr).text();
      expect(await child.exited).toBe(1);
      expect(JSON.parse(output).error.message).toContain(error);
      expect(output).not.toContain('secret-value');
      expect(output).not.toContain('Run o11 login --server');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
