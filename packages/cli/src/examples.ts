import { object } from './http-client';
import { payload } from './health';
import { validateInput } from './validate';
function sample(schema: unknown, root: Record<string, unknown>, depth = 0): unknown {
  if (!object(schema) || depth > 12) return null;
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
    let resolved: unknown = root;
    for (const key of schema.$ref.slice(2).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'))) resolved = object(resolved) ? resolved[key] : undefined;
    return sample(resolved, root, depth + 1);
  }
  if ('default' in schema) return schema.default;
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map(item => sample(item, root, depth + 1));
    if (parts.every(object)) return Object.assign({}, ...parts);
    return parts.find(value => value !== null) ?? null;
  }
  const union = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
  if (union) return sample(union.find(item => object(item) && item.type !== 'null') ?? union[0], root, depth + 1);
  const type = Array.isArray(schema.type) ? schema.type.find(item => item !== 'null') : schema.type;
  if (type === 'object' || object(schema.properties)) {
    const properties = object(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
    return Object.fromEntries(required.map(key => [key, sample(properties[key], root, depth + 1)]));
  }
  if (type === 'array') return Array.from({ length: Math.min(typeof schema.minItems === 'number' ? schema.minItems : 0, 20) }, () => sample(schema.items, root, depth + 1));
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') {
    let value = typeof schema.minimum === 'number' ? schema.minimum : typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum + 1 : 0;
    if (typeof schema.maximum === 'number') value = Math.min(value, schema.maximum);
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) value = Math.ceil(value / schema.multipleOf) * schema.multipleOf;
    return value;
  }
  if (type === 'string') {
    const formats: Record<string, string> = { uuid: '00000000-0000-4000-8000-000000000000', 'date-time': '2000-01-01T00:00:00.000Z', date: '2000-01-01', email: 'example@example.invalid', uri: 'https://example.invalid', url: 'https://example.invalid', hostname: 'example.invalid', ipv4: '127.0.0.1' };
    if (typeof schema.format === 'string' && formats[schema.format]) return formats[schema.format];
    const minimum = typeof schema.minLength === 'number' ? schema.minLength : 1;
    const maximum = typeof schema.maxLength === 'number' ? schema.maxLength : Math.max(minimum, 7);
    return 'example'.repeat(Math.ceil(Math.max(1, minimum) / 7)).slice(0, Math.min(maximum, 2048));
  }
  return null;
}
export function commandExample(descriptor: Record<string, unknown>) {
  const info = payload(descriptor);
  if (!object(info.inputSchema)) throw new Error('Command schema is unavailable.');
  const input = sample(info.inputSchema, info.inputSchema);
  if (!object(input)) throw new Error('Command schema does not describe an object input.');
  const validation = validateInput(input, descriptor);
  return { path: info.path, valid: validation.valid, input, issues: validation.issues,
    message: validation.valid ? 'Structurally valid placeholder input. Replace example values with authorized resource IDs and generate a fresh operation ID before writing.' : 'This schema needs caller-supplied values. Resolve the listed fields before executing.',
    ...(descriptor.cache ? { cache: descriptor.cache } : {}) };
}
