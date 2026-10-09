function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const cell = (value: unknown) => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
function commandHelp(value: Record<string, unknown>): string {
  const fields = new Map<string, { schema: Record<string, unknown>; required: boolean }>();
  const visit = (schema: unknown) => {
    if (!object(schema)) return;
    if (Array.isArray(schema.allOf)) schema.allOf.forEach(visit);
    if (object(schema.properties)) for (const [name, item] of Object.entries(schema.properties)) {
      if (object(item)) fields.set(name, { schema: item, required: Array.isArray(schema.required) && schema.required.includes(name) });
    }
  };
  visit(value.inputSchema);
  const flags: Record<string, string> = { id: '--id', name: '--name', description: '--description', routineId: '--routine-id', customerId: '--customer-id', expectedUpdatedAt: '--expected-updated-at', includeDisabled: '--include-disabled', organizationId: '--organization-id', environment: '--environment', projectId: '--project-id', sourceId: '--source-id', revision: '--revision', _operationId: '--operation-id', _resultLimit: '--limit', _resultOffset: '--offset', _resultFields: '--fields' };
  const lines = [...fields].map(([name, { schema, required }]) => {
    const scalar = ['string', 'number', 'integer', 'boolean'].includes(String(schema.type)) || Array.isArray(schema.enum) && schema.enum.every(item => typeof item === 'string');
    const flag = flags[name] ?? (scalar ? `--${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}` : `--set '${name}=JSON'`);
    return `  ${flag}  ${schema.type ?? 'JSON'}${required ? ' (required)' : ''}${schema.enum ? `: ${cell(schema.enum)}` : ''}${schema.description ? ` — ${schema.description}` : ''}`;
  });
  return [`o11 ${value.command}`, String(value.description ?? ''), '', ...lines, '', 'Use --input FILE|- for structured input; --json returns the complete schema.', 'The connected workspace supplies organizationId when omitted.'].join('\n');
}
export function format(value: unknown): string {
  if (object(value) && value.command && value.inputSchema) return commandHelp(value);
  if (object(value) && typeof value.organizationId === 'string' && Array.isArray(value.scopes) && object(value.readiness)) {
    const workflow = object(value.workflow) ? value.workflow : undefined;
    return [`Workspace: ${value.organizationId}`, `Permissions: ${value.scopes.join(', ')}`, '',
      ...Object.entries(value.readiness).map(([name, ready]) => `${name}: ${ready ? 'ready' : 'unavailable'}`),
      ...(workflow ? ['', `Workflow: ${cell(workflow.state ?? 'unknown')}`, `Revision: ${cell(workflow.revision)}`, `Checked: ${cell(workflow.checkedAt)}`,
        ...(Array.isArray(workflow.blockers) ? workflow.blockers.filter(object).map(item => `Blocked: ${cell(item.message)}${item.owner ? ` (${cell(item.owner)})` : ''}`) : []),
        ...(Array.isArray(workflow.next) ? workflow.next.filter(object).map(item => `Next: ${cell(item.label)}${item.available === false ? ' (permission required)' : ''}`) : [])] : []),
      '', 'Use o11 commands to explore, or o11 status --json for the full setup report.'].join('\n');
  }
  if (object(value) && typeof value.markdown === 'string') return value.markdown;
  if (Array.isArray(value)) {
    if (!value.length) return 'No results.';
    if (value.every(object)) {
      const fields = ['command', 'id', 'name', 'title', 'status', 'environment', 'revision', 'description'].filter(key => value.some(row => key in row));
      if (fields.length) return [fields.join('\t'), ...value.map(row => fields.map(key => cell(row[key])).join('\t'))].join('\n');
    }
  }
  if (object(value)) return Object.entries(value).map(([key, item]) => `${key}: ${typeof item === 'object' && item !== null ? JSON.stringify(item, null, 2) : cell(item)}`).join('\n');
  return cell(value);
}
export function render(value: unknown, json: boolean): string {
  if (json) return JSON.stringify(value, null, 2);
  if (object(value) && 'result' in value) {
    return [format(value.result), value.page ? `Page: ${JSON.stringify(value.page)}` : '', value.operation ? `Operation: ${JSON.stringify(value.operation)}` : '', value.message ? String(value.message) : ''].filter(Boolean).join('\n');
  }
  return format(value);
}
export const help = `o11 — configure your workspace from the terminal

  o11 login --server https://YOUR_API       Sign in once; reuse saved access
  o11 status [--routine-id ID]             Inspect workspace or saved routine setup
  o11 check --routine-id ID                Require verified current execution (exit 2 otherwise)
  o11 setup plan --routine-id ID           Inspect steps and blockers
  o11 setup apply --routine-id ID          Apply authorized no-send configuration steps
  o11 setup resume --routine-id ID         Resume with saved operation IDs
  o11 wait --routine-id ID                 Wait for verified execution
  o11 watch --id UUID                      Emit receipt changes as JSON lines
  o11 profiles list|inspect|select NAME    Inspect or select a local profile
  o11 profiles pin --organization-id ID    Pin the expected workspace
  o11 commands [--search TEXT] [--all]      Discover commands and permission gaps
  o11 routines list                       List routines
  o11 routines get --id ID                 Read a routine
  o11 routines save --input draft.json --operation-id UUID
  o11 tracking status --environment test   Inspect tracking
  o11 signals sources                     Discover sources
  o11 operations status --id UUID          Inspect an uncertain write
  o11 operation-id                         Generate a UUID before a write
  o11 docs [PAGE] [--live]                  Read offline or current docs
  o11 mcp                                 Optional local MCP bridge
  o11 update [--check]                    Check or install the server’s CLI release
  o11 verify --input evaluations.json      Check labeled cases against recorded evidence
  o11 validate routines save --input FILE Check input without executing it
  o11 batch --input batch.json             Execute bounded, resumable independent items
  o11 diagnostics --output-file FILE      Save a redacted support bundle
  o11 install --input manifest.json        Install a checksum-pinned release
  o11 benchmark --set iterations=5        Measure cold startup and offline docs
  o11 example routines save               Generate and validate placeholder input
  o11 completion bash|zsh|fish             Print shell completion
  o11 logout                              Remove local credentials

Use o11 <command> --help for its fields and required input.
--json returns structured output for agents; redirected output is JSON by default.
--input FILE|- reads a JSON object. --set field=JSON supplies other fields.
--set-file field=PATH reads a secret from a private file without shell argument exposure.
--output-file FILE saves results privately without printing their contents.
--reauth explicitly starts a fresh login; ordinary login reuses saved access.
--check fails on invalid, blocked, deferred, or unverified results.
--require-capability NAME and --max-lag-seconds N add health assertions.
wait/watch use --timeout MS (default 300000) and --interval MS (default 2000).
setup apply/resume use --journal FILE and --max-steps N (default 20).
--expect-organization ID and --expect-environment test|production pin request context.
Use --help --offline for previously cached command schemas. Cached permissions may be stale.
--profile NAME separates credentials. --no-browser supports remote sign-in.
--credential-store file explicitly selects private files instead of the OS keyring.
Complete a waiting remote login with o11 login --input FILE|-.
Writes need --operation-id UUID. Reuse it with identical input after checking status.
Legacy tools list/describe and call TOOL are supported over the HTTP API.`;
