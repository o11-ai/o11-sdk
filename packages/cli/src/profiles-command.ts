import { join } from 'node:path';
import { z } from 'zod';
import { configRoot, profileName } from './profile';
import { readPrivateJson, writePrivateJson } from './local-state';
import { withProfileLock } from './credential-lock';
import { object } from './http-client';
const preferencesSchema = z.object({ selected: profileName.default('default'), pins: z.record(z.string(), z.object({ organizationId: z.string().optional(), environment: z.enum(['test', 'production']).optional() })).default({}) });
const preferencesPath = () => join(configRoot(), 'preferences.json');
async function preferences() { return preferencesSchema.parse(await readPrivateJson(preferencesPath()) ?? {}); }
export async function selectedProfile(explicit?: string) { return profileName.parse(explicit ?? process.env.O11_PROFILE ?? (await preferences()).selected); }
export async function profilePins(profile: string) { return (await preferences()).pins[profile] ?? {}; }
export async function profilesCommand(action: string | undefined, name: string | undefined, profile: string, input: Record<string, unknown>) {
  const saved = await readPrivateJson(join(configRoot(), 'profiles.json')) ?? {};
  if (!object(saved)) throw new Error('Invalid profile configuration.');
  const current = await preferences();
  if (action === 'select') {
    const selected = profileName.parse(name);
    if (!object(saved[selected])) throw new Error('Unknown profile. Run o11 profiles list.');
    await withProfileLock(async () => writePrivateJson(preferencesPath(), { ...await preferences(), selected }));
    return { selected };
  }
  if (action === 'pin') {
    const pins = preferencesSchema.shape.pins.parse({ [profile]: input });
    if (!input.organizationId && !input.environment) throw new Error('Use profiles pin --organization-id ID and/or --environment test|production.');
    await withProfileLock(async () => { const existing = await preferences(); await writePrivateJson(preferencesPath(), { ...existing, pins: { ...existing.pins, [profile]: { ...existing.pins[profile], ...pins[profile] } } }); });
    return { profile, pins: await profilePins(profile) };
  }
  if (action && !['list', 'inspect'].includes(action)) throw new Error('Use profiles list, inspect, select NAME, or pin.');
  const describe = (key: string, item: Record<string, unknown>) => ({ name: key, selected: key === current.selected, server: item.server, credentialStore: item.credentialStore ?? 'keyring', pins: current.pins[key] ?? {} });
  if (action === 'inspect') {
    const item = saved[profile];
    return { ...(object(item) ? describe(profile, item) : { name: profile, saved: false }), overrides: { server: process.env.O11_SERVER ?? null, profile: process.env.O11_PROFILE ?? null, serviceToken: !!(process.env.O11_TOKEN || process.env.O11_TOKEN_FILE) } };
  }
  return { selected: current.selected, profiles: Object.entries(saved).filter((pair): pair is [string, Record<string, unknown>] => object(pair[1])).map(([key, item]) => describe(key, item)) };
}
export function pinnedInput(input: Record<string, unknown>, expected: { organizationId?: string; environment?: string }) {
  const resolved = { ...input };
  for (const key of ['organizationId', 'environment'] as const) {
    if (!expected[key]) continue;
    if (resolved[key] !== undefined && resolved[key] !== expected[key]) throw new Error(`Context mismatch: ${key} does not match the expected profile context.`);
    resolved[key] = expected[key];
  }
  return resolved;
}
