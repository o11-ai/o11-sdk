import { parseArgs } from 'node:util';
import { options } from './arguments';
import { object } from './http-client';
import { payload } from './health';

/** Discover additional long flags locally, then validate them against live inputs. */
export function parseCommandArgs(argv: string[]) {
  const dynamic: Record<string, { type: 'string' | 'boolean' }> = {};
  for (let i = 0; i < argv.length && argv[i] !== '--'; i++) {
    const match = /^--([a-z][a-z0-9-]*)(?:=([\s\S]*))?$/.exec(argv[i]!);
    if (!match || Object.hasOwn(options, match[1]!)) continue;
    const next = argv[i + 1];
    dynamic[match[1]!] = { type: match[2] !== undefined || next !== undefined && (!next.startsWith('-') || /^-\d/.test(next)) ? 'string' : 'boolean' };
  }
  return { ...parseArgs({ args: argv, options: { ...dynamic, ...options }, allowPositionals: true }), dynamic };
}

export function schemaProperties(schema: unknown): Record<string, unknown> {
  if (!object(schema)) return {};
  return Object.assign({}, ...(Array.isArray(schema.allOf) ? schema.allOf.map(schemaProperties) : []), object(schema.properties) ? schema.properties : {});
}

/** Omit an implicit pin only when a strict command has no environment input. */
export function applyPinnedEnvironment(input: Record<string, unknown>, pinned: boolean, descriptor: Record<string, unknown>) {
  const schema = payload(descriptor).inputSchema;
  if (!pinned || !object(schema) || schema.additionalProperties !== false || Object.hasOwn(schemaProperties(schema), 'environment')) return input;
  const { environment: ignored, ...result } = input;
  return result;
}

export function applySchemaFlags(input: Record<string, unknown>, values: Record<string, unknown>, flags: string[], descriptor: Record<string, unknown>) {
  const properties = schemaProperties(payload(descriptor).inputSchema);
  const result = { ...input };
  for (const flag of flags) {
    const key = flag.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !Object.hasOwn(properties, key)) throw new Error(`--${flag} is not an input for this command. Inspect --help.`);
    const schema = properties[key];
    if (!object(schema)) throw new Error(`Use --input for ${key}.`);
    const types = Array.isArray(schema.type) ? schema.type.filter(type => type !== 'null') : [schema.type];
    let value: unknown = values[flag];
    if (types.includes('boolean')) {
      if (value === 'true' || value === 'false') value = value === 'true';
      else if (typeof value !== 'boolean') throw new Error(`--${flag} requires true or false.`);
    } else if (types.includes('number') || types.includes('integer')) {
      if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value))) throw new Error(`--${flag} requires a number.`);
      value = Number(value);
      if (types.includes('integer') && !Number.isSafeInteger(value)) throw new Error(`--${flag} requires an integer.`);
    } else if (types.includes('string') || Array.isArray(schema.enum) && schema.enum.every(item => typeof item === 'string')) {
      if (typeof value !== 'string') throw new Error(`--${flag} requires a value.`);
    } else throw new Error(`Use --input or --set '${key}=JSON' for structured input.`);
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error(`--${flag} requires one of: ${schema.enum.join(', ')}.`);
    if (Object.hasOwn(result, key) && JSON.stringify(result[key]) !== JSON.stringify(value)) throw new Error(`Conflicting values for ${key}.`);
    result[key] = value;
  }
  return result;
}
