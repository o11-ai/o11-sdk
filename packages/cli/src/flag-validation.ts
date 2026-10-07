const transport = ['server', 'profile', 'credential-store', 'json', 'output-file', 'help'];
const input = ['input', 'set', 'set-file', 'organization-id', 'environment', 'expect-organization', 'expect-environment'];
const setup = [...input, 'routine-id', 'check', 'require-capability', 'max-lag-seconds'];
const allowed: Record<string, string[]> = {
  login: ['input', 'scope', 'no-browser', 'reauth'], logout: [], mcp: [], update: ['check'],
  status: setup, check: setup, setup: [...setup, 'journal', 'max-steps'],
  wait: [...setup, 'id', 'timeout', 'interval', 'path'], watch: [...setup, 'id', 'timeout', 'interval', 'path'],
  commands: ['search', 'all', 'offline'], tools: ['search', 'all', 'offline'],
  docs: ['search', 'live', 'offline'], profiles: ['organization-id', 'environment'],
  completion: ['live'], 'operation-id': [], verify: input,
  validate: [...input, 'offline', 'id', 'name', 'revision', 'routine-id', 'source-id', 'operation-id'], batch: [...input, 'journal'],
  diagnostics: setup,
  install: ['input'],
  benchmark: ['input', 'set'], example: ['offline'],
};
export function validateFlags(command: string, values: Record<string, unknown>) {
  if ((values.scope !== undefined || values['no-browser'] !== undefined || values.reauth !== undefined) && command !== 'login') throw new Error('--scope, --no-browser and --reauth are available only for login.');
  const permitted = allowed[command];
  if (!permitted) {
    for (const flag of ['live', 'all', 'search', 'scope', 'no-browser', 'reauth', 'journal', 'max-steps', 'timeout', 'interval', 'path', 'require-capability', 'max-lag-seconds']) {
      if (values[flag] !== undefined) throw new Error(`--${flag} is not supported for this command.`);
    }
    return;
  }
  const set = new Set([...transport, ...permitted]);
  for (const flag of Object.keys(values)) if (values[flag] !== undefined && !set.has(flag)) throw new Error(`--${flag} is not supported for ${command}.`);
}
export function positiveInteger(value: string | undefined, fallback: number, flag: string, maximum = 86_400_000) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) throw new Error(`--${flag} requires an integer between 1 and ${maximum}.`);
  return Number(value);
}
