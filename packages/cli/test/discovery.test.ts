import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandExample } from '../src/examples';
import { cachedDiscovery, cachedCommands, completionScript, saveDiscovery } from '../src/schema-cache';
test('generated examples are validated, including caller-specific constraints that cannot be guessed', () => {
  const schema = { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, enabled: { type: 'boolean' }, rules: { type: 'array', minItems: 1, items: { type: 'object', properties: { count: { type: 'integer', minimum: 3 } }, required: ['count'] } } }, required: ['id', 'rules'] };
  const example = commandExample({ result: { inputSchema: schema } });
  expect(example.valid).toBe(true); expect(example.input.rules).toEqual([{ count: 3 }]);
  const constrained = commandExample({ result: { inputSchema: { type: 'object', properties: { code: { type: 'string', pattern: '^customer-[0-9]{10}$' } }, required: ['code'] } } });
  expect(constrained.valid).toBe(false); expect(constrained.issues[0]?.path).toBe('code');
});
test('discovery cache cannot reuse schemas from a different build, permission fingerprint, profile or host', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-discovery-')), previous = process.env.O11_CONFIG_DIR;
  process.env.O11_CONFIG_DIR = dir;
  const response = (version: string, permission: string) => ({ server: { schemaVersion: version }, access: { fingerprint: permission }, result: { inputSchema: { type: 'object' } } });
  try {
    await saveDiscovery('https://one.test', 'default', 'commands/test', response('v1', 'read'));
    expect((await cachedDiscovery('https://one.test', 'default', 'commands/test')).cache).toMatchObject({ authoritative: false, identity: { schemaVersion: 'v1', fingerprint: 'read' } });
    await saveDiscovery('https://one.test', 'default', 'commands', response('v2', 'read'));
    await expect(cachedDiscovery('https://one.test', 'default', 'commands/test')).rejects.toThrow('No cached help');
    await saveDiscovery('https://one.test', 'default', 'commands/test', response('v2', 'read'));
    await saveDiscovery('https://one.test', 'default', 'commands', response('v2', 'configure'));
    await expect(cachedDiscovery('https://one.test', 'default', 'commands/test')).rejects.toThrow();
    await expect(cachedDiscovery('https://other.test', 'default', 'commands')).rejects.toThrow();
    await expect(cachedDiscovery('https://one.test', 'other', 'commands')).rejects.toThrow();
  } finally { if (previous === undefined) delete process.env.O11_CONFIG_DIR; else process.env.O11_CONFIG_DIR = previous; await rm(dir, { recursive: true, force: true }); }
});
test('live completion rejects shell syntax in remote command names', () => {
  const script = completionScript('bash', ['routines validate-signal', 'bad $(touch /tmp/o11-unsafe)']);
  expect(script).toContain('validate-signal'); expect(script).not.toContain('touch');
  const parsed = Bun.spawnSync(['bash', '-n'], { stdin: Buffer.from(script) }); expect(parsed.exitCode).toBe(0);
});
test('offline completion uses the last complete allowed list for the current observed identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'o11-completion-')), previous = process.env.O11_CONFIG_DIR;
  process.env.O11_CONFIG_DIR = dir;
  const identity = { server: { schemaVersion: 'v1' }, access: { fingerprint: 'read' } };
  try {
    expect(await cachedCommands('https://one.test', 'default')).toEqual([]);
    await saveDiscovery('https://one.test', 'default', 'commands?all=true', { ...identity, result: [{ command: 'routines list', available: true }, { command: 'routines delete', available: false }, { command: 'ambiguous command' }] });
    expect(await cachedCommands('https://one.test', 'default')).toEqual(['routines list']);
    await saveDiscovery('https://one.test', 'default', 'commands?search=other', { ...identity, result: [] });
    expect(await cachedCommands('https://one.test', 'default')).toEqual(['routines list']);
    expect(await cachedCommands('https://one.test', 'other')).toEqual([]);
    await saveDiscovery('https://one.test', 'default', 'commands/test', { ...identity, server: { schemaVersion: 'v2' }, result: {} });
    expect(await cachedCommands('https://one.test', 'default')).toEqual([]);
  } finally { if (previous === undefined) delete process.env.O11_CONFIG_DIR; else process.env.O11_CONFIG_DIR = previous; await rm(dir, { recursive: true, force: true }); }
});
