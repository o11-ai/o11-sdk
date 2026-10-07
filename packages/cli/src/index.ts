#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { commandPath } from '@o11/agent-kit/commands';
import { callWithOutput, OutputSaveError } from './output';
import { loadServer, loadCredentialMode, configRoot } from './profile';
import { selectedProfile, profilesCommand, profilePins, pinnedInput } from './profiles-command';
import { redirectUrl } from './login-input';
import { readLoginInput, submitLoginInput } from './login-input';
import { agentDocs, readDoc } from './docs.js';
import { ApiClient, ApiError, object } from './http-client';
import { readInput } from './arguments';
import { render, help } from './format';
import { version } from './version';
import { availableUpdate, bundleSha256, installUpdate } from './update';
import { healthIssues } from './health';
import { waitFor } from './wait';
import { applySetup, setupPlan } from './setup';
import { cachedDiscovery, saveDiscovery, completionScript, cachedCommands } from './schema-cache';
import { positiveInteger, validateFlags } from './flag-validation';
import { validateInput } from './validate';
import { runBatch } from './batch';
import { serviceToken } from './service-token';
import { diagnosticBundle } from './diagnostics';
import { payload } from './health';
import { commandExample } from './examples';
import { parseCommandArgs, applySchemaFlags } from './schema-flags';

export async function run(argv: string[]) {
  const { values, positionals, dynamic } = parseCommandArgs(argv);
  const [command, name] = positionals;
  const json = values.json || !process.stdout.isTTY;
  const print = (value: unknown) => process.stdout.write(command === 'watch' && !values['output-file'] ? JSON.stringify({ event: 'complete', value }) + '\n' : render(value, json) + '\n');
  const healthOptions = { requireOutcome: true, capabilities: values['require-capability'], maxLagSeconds: values['max-lag-seconds'] === undefined ? undefined : positiveInteger(values['max-lag-seconds'], 0, 'max-lag-seconds') };
  const emit = async (call: () => Promise<unknown>, check = values.check === true) => {
    const result = await callWithOutput(call, values['output-file']);
    check = check || !!healthOptions.capabilities?.length || healthOptions.maxLagSeconds !== undefined;
    const observed = (command === 'wait' || command === 'watch') && object(result) && object(result.result) ? result.result : result;
    const issues = check ? healthIssues(observed, healthOptions) : [];
    print(values['output-file'] ? { saved: values['output-file'], ...(check ? { verified: !issues.length, issues } : {}) } : check ? { ...(object(result) ? result : { result }), check: { verified: !issues.length, issues } } : result);
    if (issues.length) process.exitCode = 2;
    return result;
  };
  if (values.version) { await emit(async () => ({ version, bundleSha256: await bundleSha256() })); return; }
  if (!command) { await emit(async () => json ? { help } : help); return; }
  validateFlags(command, values);
  const local = ['login', 'logout', 'mcp', 'docs', 'operation-id', 'status', 'commands', 'setup', 'check', 'wait', 'watch', 'profiles', 'completion', 'verify', 'validate', 'batch', 'diagnostics', 'install', 'benchmark', 'example', 'update'];
  if (values.help && (local.includes(command) || command === 'operations')) { await emit(async () => ({ help })); return; }
  if (command === 'operation-id') { if (positionals.length !== 1) throw new Error('Use o11 operation-id.'); await emit(async () => ({ id: crypto.randomUUID() })); return; }
  if (command === 'completion' && !values.live) {
    if (positionals.length !== 2) throw new Error('Use o11 completion bash|zsh|fish.');
    await emit(async () => {
      let commands: string[] = [];
      try { const profile = await selectedProfile(values.profile); const server = await loadServer(profile, values.server); commands = await cachedCommands(server.href, profile); }
      catch { /* Completion remains available before login and with unavailable local state. */ }
      return completionScript(name!, commands);
    }); return;
  }
  if (command === 'docs' && !values.live) {
    if (positionals.length > 2) throw new Error('Use o11 docs [PAGE].');
    const doc = name ? readDoc(name) : undefined;
    if (name && !doc) throw new Error('Unknown documentation page. Run o11 docs.');
    const search = values.search?.toLowerCase();
    await emit(async () => doc ?? agentDocs.filter(doc => !search || JSON.stringify(doc).toLowerCase().includes(search)).map(({ markdown: _, ...doc }) => doc)); return;
  }
  if (command === 'login' && values.input !== undefined) {
    if (name || values.scope !== undefined || values.server !== undefined || values['no-browser'] || values.reauth || values['credential-store'] !== undefined) throw new Error('Use login --input FILE|- by itself to complete the waiting login.');
    await emit(async () => submitLoginInput(await readLoginInput(values.input!))); return;
  }
  if ((['login', 'logout', 'status', 'mcp', 'commands', 'check', 'wait', 'watch', 'verify'].includes(command) && positionals.length !== 1) || (command === 'docs' && positionals.length > 2) || (command === 'call' && positionals.length !== 2)) throw new Error('Unexpected command arguments. Run o11 --help.');
  if (command === 'setup' && (positionals.length > 2 || (name !== undefined && !['plan', 'apply', 'resume'].includes(name)))) throw new Error('Use setup plan, apply, or resume.');
  if (command === 'setup' && (!name || name === 'plan') && (values.journal || values['max-steps'])) throw new Error('--journal and --max-steps apply only to setup apply or resume.');
  if (command === 'profiles' && positionals.length > (name === 'select' ? 3 : 2)) throw new Error('Unexpected profiles arguments.');
  if (command === 'tools' && !((!name && positionals.length === 1) || (name === 'list' && positionals.length === 2) || (name === 'describe' && positionals.length === 3))) throw new Error('Use tools list or tools describe TOOL.');
  if (command === 'tools' && name === 'describe' && (values.search || values.all)) throw new Error('--search and --all apply only to tools list.');
  if (command === 'operations' && (name !== 'status' || positionals.length !== 2)) throw new Error('Use o11 operations status --id UUID.');
  if (![...local, 'tools', 'call', 'operations', 'routines', 'personas', 'surveys', 'customers', 'inbox', 'knowledge', 'channels', 'replies', 'templates', 'tracking', 'database', 'identities', 'signals', 'analytics', 'research', 'account', 'organization', 'insights', 'billing', 'engagement'].includes(command) && positionals.length < 2) throw new Error('Unknown command. Run o11 commands.');
  let input = await readInput(values);
  const inputKeys = command === 'operations' || command === 'call' && name === 'o11_operation_status' ? ['id', 'organizationId'] : command === 'call' && name === 'o11_docs' ? ['page', 'query', 'search'] : undefined;
  if (inputKeys) for (const key of Object.keys(input)) if (!inputKeys.includes(key)) throw new Error(`Unsupported field for this command: ${key}.`);
  if (command === 'install') { const { installPinned } = await import('./install'); await emit(async () => installPinned(input)); return; }
  if (command === 'benchmark') { const { benchmarkCli } = await import('./benchmark'); await emit(async () => benchmarkCli(input)); return; }
  const profile = await selectedProfile(values.profile);
  if (command === 'profiles') { await emit(async () => profilesCommand(name, positionals[2], profile, input)); return; }
  const pins = await profilePins(profile);
  input = pinnedInput(input, { organizationId: values['expect-organization'] ?? pins.organizationId, environment: values['expect-environment'] ?? pins.environment });
  const server = await loadServer(profile, values.server);
  if (command === 'update') {
    if (positionals.length !== 1) throw new Error('Use o11 update [--check].');
    const release = await availableUpdate(server);
    const installation = !values.check && release.updateAvailable ? await installUpdate(release) : undefined;
    await emit(async () => ({ ...release, updated: !!installation, ...(installation ? { installation,
      nextStep: 'Use installation.command for subsequent calls with the same server and verified profile, then retry the affected command.' } : {}) }), false); return;
  }
  const legacy = command === 'call' || (command === 'tools' && name === 'describe');
  const target = command === 'call' ? name : positionals[2];
  let path = legacy ? target?.replaceAll('_', '.') : commandPath(command === 'validate' || command === 'example' ? positionals.slice(1) : positionals);
  if (legacy && !target) throw new Error('Specify an operation. Run o11 commands.');
  const discoveryPath = 'commands/' + encodeURIComponent(path!);
  if (command === 'validate' && values.offline) { await emit(async () => { const result = validateInput(input, await cachedDiscovery(server.href, profile, discoveryPath)); if (!result.valid) process.exitCode = 2; return result; }); return; }
  if (command === 'example' && values.offline) { await emit(async () => { const result = commandExample(await cachedDiscovery(server.href, profile, discoveryPath)); if (!result.valid) process.exitCode = 2; return result; }); return; }
  if (values.offline && (values.help || command === 'tools' && name === 'describe')) { await emit(async () => cachedDiscovery(server.href, profile, discoveryPath)); return; }
  if (values.offline && command !== 'commands' && command !== 'tools' && command !== 'docs') throw new Error('--offline supports cached help and discovery only.');
  const mode = await loadCredentialMode(profile, server, values['credential-store']);
  if (command === 'login') { const { login } = await import('./login'); await emit(async () => login(server, profile, values.scope, { credentialStore: mode, noBrowser: values['no-browser'], reauth: values.reauth })); return; }
  if (command === 'logout') { const { credentialStore } = await import('./vault'); await emit(async () => { const store = await credentialStore(profile, server, mode); await store.exclusive!(() => store.clear()); return { loggedOut: true }; }); return; }
  const query = new URLSearchParams();
  if (values.search) query.set('search', values.search);
  if (values.all) query.set('all', 'true');
  const listPath = 'commands' + (query.size ? '?' + query : '');
  if (values.offline && (command === 'commands' || command === 'tools')) { await emit(async () => cachedDiscovery(server.href, profile, listPath)); return; }
  const token = await serviceToken();
  const auth = token ? undefined : await import('./vault');
  const provider = !auth ? undefined : await new auth.CliAuth(redirectUrl, await auth.credentialStore(profile, server, mode), async () => { throw new auth.LoginRequiredError(); }).load();
  if (command === 'mcp') {
    if (values['output-file']) throw new Error('--output-file is unavailable for the MCP transport.');
    const { connect } = await import('./client'); const { bridge } = await import('./bridge');
    await bridge(await connect(server, provider?.transportAuth(), token)); return;
  }
  const api = new ApiClient(server, provider?.transportAuth(), token);
  if (command === 'completion') { if (positionals.length !== 2) throw new Error('Use o11 completion bash|zsh|fish [--live].'); await emit(async () => { const response = await api.request('commands'); await saveDiscovery(server.href, profile, 'commands', response); return completionScript(name!, Array.isArray(response.result) ? response.result.filter(object).map(row => String(row.command ?? '')) : []); }); return; }
  if (command === 'validate') { await emit(async () => { const descriptor = await api.request(discoveryPath); await saveDiscovery(server.href, profile, discoveryPath, descriptor); const result = validateInput(input, descriptor); if (!result.valid) process.exitCode = 2; return result; }); return; }
  if (command === 'example') { await emit(async () => { const descriptor = await api.request(discoveryPath); await saveDiscovery(server.href, profile, discoveryPath, descriptor); const result = commandExample(descriptor); if (!result.valid) process.exitCode = 2; return result; }); return; }
  if (command === 'batch') { await emit(async () => { const target = JSON.stringify({ server: server.href, profile }); const key = createHash('sha256').update(target + JSON.stringify(input)).digest('hex'); const result = await runBatch(input, api, { journal: values.journal ?? join(configRoot(), 'batches', `${key}.json`), target }); if (result.failed) process.exitCode = 2; return result; }); return; }
  const statusInput = () => { for (const key of Object.keys(input)) if (!['organizationId', 'routineId', 'environment'].includes(key)) throw new Error(`Unsupported setup field: ${key}.`); return input; };
  if (command === 'diagnostics') { await emit(async () => diagnosticBundle(await api.request('status', statusInput()))); return; }
  if (command === 'status' || command === 'check') { await emit(async () => api.request('status', Object.keys(statusInput()).length ? input : undefined), command === 'check' || values.check); if (command === 'status' && process.stderr.isTTY && !json) { try { const release = await availableUpdate(server); if (release.updateAvailable) process.stderr.write(`CLI ${release.version} is available. Run o11 update --check.\n`); } catch { /* Update discovery never blocks workspace access. */ } } return; }
  if (command === 'setup') {
    const context = statusInput();
    await emit(async () => {
      if (!name || name === 'plan') { const plan = setupPlan(await api.request('status', context)); return { ...plan.snapshot, plan: plan.steps }; }
      const journalKey = createHash('sha256').update(JSON.stringify({ server: server.href, profile, ...context })).digest('hex');
      const result = await applySetup(api, context, { journal: values.journal ?? join(configRoot(), 'workflows', `${journalKey}.json`), server: server.href, profile, maxSteps: positiveInteger(values['max-steps'], 20, 'max-steps', 100) });
      if (object(result.setup) && ['blocked', 'stalled', 'step_limit'].includes(String(result.setup.state))) process.exitCode = 2;
      return result;
    }, name === 'apply' || name === 'resume' || values.check); return;
  }
  if (command === 'wait' || command === 'watch') {
    const controller = new AbortController(); const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      await emit(async () => {
        const operation = typeof input.id === 'string' ? input.id : undefined;
        const progressPath = values.path;
        if (progressPath) {
          if (!/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/.test(progressPath)) throw new Error('--path requires a dotted operation path from command discovery.');
          const descriptor = await api.request('commands/' + encodeURIComponent(progressPath), undefined, { signal: controller.signal });
          if (payload(descriptor).mutation !== false) throw new Error('Polling requires a read-only procedure. Submit work separately and poll its progress.');
          if (!validateInput(input, descriptor).valid) throw new Error('Progress input does not match its command schema. Run o11 validate for field errors.');
        } else if (operation) { for (const key of Object.keys(input)) if (!['id', 'organizationId'].includes(key)) throw new Error(`Unsupported receipt wait field: ${key}.`); } else statusInput();
        const result = await waitFor(signal => progressPath ? api.request('execute/' + encodeURIComponent(progressPath), input, { signal }) : operation ? api.request('operations/' + encodeURIComponent(operation), typeof input.organizationId === 'string' ? { organizationId: input.organizationId } : undefined, { signal }) : api.request('status', input, { signal }), { signal: controller.signal, timeoutMs: positiveInteger(values.timeout, 300_000, 'timeout'), intervalMs: positiveInteger(values.interval, 2000, 'interval', 60_000), ...(command === 'watch' && !values['output-file'] ? { changed: (value: Record<string, unknown>) => process.stdout.write(JSON.stringify({ event: 'state', value }) + '\n') } : {}) });
        if (result.state !== 'success') process.exitCode = result.state === 'cancelled' ? 130 : 2;
        return result;
      });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      process.exitCode = 130; print({ state: 'cancelled', message: 'Local waiting stopped. Remote work was not cancelled.' });
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    return;
  }
  if (command === 'verify') {
    const { verify } = await import('./verify');
    await emit(async () => { const result = await verify(input, api); if (!result.verified) process.exitCode = 2; return result; }); return;
  }
  const docs = (page?: unknown, search?: unknown) => { const query = new URLSearchParams(); if (typeof search === 'string') query.set('search', search); return (typeof page === 'string' ? 'docs/' + encodeURIComponent(page) : 'docs') + (query.size ? '?' + query : ''); };
  if (command === 'docs') { await emit(async () => api.request(docs(name, values.search))); return; }
  if (command === 'operations' && name === 'status') {
    if (typeof input.id !== 'string') throw new Error('Use o11 operations status --id UUID.');
    await emit(async () => api.request('operations/' + encodeURIComponent(String(input.id)), typeof input.organizationId === 'string' ? { organizationId: input.organizationId } : undefined)); return;
  }
  if (command === 'commands' || (command === 'tools' && (!name || name === 'list'))) {
    await emit(async () => { const response = await api.request(listPath); await saveDiscovery(server.href, profile, listPath, response); return response; }); return;
  }
  if (values.help || command === 'tools' || (!legacy && positionals.length === 1)) {
    await emit(async () => { const response = await api.request(discoveryPath); await saveDiscovery(server.href, profile, discoveryPath, response); return response; }); return;
  }
  if (command === 'call' && target === 'o11_setup') { await emit(async () => api.request('status', statusInput())); return; }
  if (command === 'call' && target === 'o11_docs') { await emit(async () => api.request(docs(input.page, input.query ?? input.search))); return; }
  if (command === 'call' && target === 'o11_operation_status') {
    if (typeof input.id !== 'string') throw new Error('Operation status requires id.');
    await emit(async () => api.request('operations/' + encodeURIComponent(String(input.id)), typeof input.organizationId === 'string' ? { organizationId: input.organizationId } : undefined)); return;
  }
  if (command === 'call' && target === 'o11_read_artifact') path = 'artifacts/read';
  if (path === 'artifacts/read') { await emit(async () => api.request(path!, input, { mutation: false })); return; }
  // An explicit write receipt already determines recovery semantics. Avoid making
  // existing resumable writes depend on an additional discovery request.
  if (!Object.keys(dynamic).length && typeof input._operationId === 'string') {
    await emit(async () => api.request('execute/' + encodeURIComponent(path!), input, { mutation: true })); return;
  }
  await emit(async () => {
    const descriptor = await api.request(discoveryPath);
    await saveDiscovery(server.href, profile, discoveryPath, descriptor);
    input = applySchemaFlags(input, values, Object.keys(dynamic), descriptor);
    const mutation = payload(descriptor).mutation;
    return api.request('execute/' + encodeURIComponent(path!), input, { mutation: typeof mutation === 'boolean' ? mutation : undefined });
  });
}
await run(process.argv.slice(2)).catch(error => {
  const details = error instanceof ApiError || error instanceof OutputSaveError ? error.details : { message: error instanceof Error ? error.message : 'Request failed.' };
  process.stderr.write(render({ error: details }, process.argv.includes('--json') || !process.stdout.isTTY) + '\n');
  process.exitCode = 1;
});
