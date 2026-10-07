import { expect, test } from 'bun:test';
import { parseCommandArgs, applySchemaFlags } from '../src/schema-flags';
import { format } from '../src/format';

const descriptor = { result: { mutation: false, inputSchema: { allOf: [{ type: 'object', properties: {
  kind: { type: 'string', enum: ['events', 'properties'] }, includeArchived: { type: 'boolean' }, maximumRows: { type: 'integer' }, definition: { type: 'object' },
} }] } } };
test('scalar flags advertised by live schemas parse and preserve command positionals', () => {
  const parsed = parseCommandArgs(['signals', 'resources', '--source-id', 'source', '--kind', 'events', '--include-archived=false', '--maximum-rows', '20']);
  expect(parsed.positionals).toEqual(['signals', 'resources']);
  expect(applySchemaFlags({ sourceId: 'source' }, parsed.values, Object.keys(parsed.dynamic), descriptor)).toEqual({ sourceId: 'source', kind: 'events', includeArchived: false, maximumRows: 20 });
  const text = format({ command: 'signals resources', inputSchema: descriptor.result.inputSchema });
  expect(text).toContain('--kind');
  expect(text).toContain('--include-archived');
  expect(text).toContain("--set 'definition=JSON'");
});
test('schema flags reject typos, invalid scalar values, structured input and conflicts before execution', () => {
  for (const [values, flags] of [[{ typo: 'value' }, ['typo']], [{ kind: 'wrong' }, ['kind']], [{ 'include-archived': 'yes' }, ['include-archived']], [{ 'maximum-rows': '2.5' }, ['maximum-rows']], [{ definition: '{}' }, ['definition']], [{ constructor: 'x' }, ['constructor']]] as const)
    expect(() => applySchemaFlags({}, values, [...flags], descriptor)).toThrow();
  expect(() => applySchemaFlags({ kind: 'properties' }, { kind: 'events' }, ['kind'], descriptor)).toThrow('Conflicting');
});
