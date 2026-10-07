import { expect, test } from 'bun:test';
import { detailedSetupPrompt as setupPrompt } from '../src/setup-workflow-guide';
import { agentKitVersion, cliVersion } from '../src/prompt';
import { agentDocs, searchDocs, readDoc } from '../src/docs';
test('one-chat setup reuses access and separates authorization from the frontend review link', () => {
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', frontendUrl: 'https://app.example.test', organizationId: 'workspace-1', routineId: 'routine-1', request: 'Welcome Excel users.' });
  expect(prompt).toContain('Return to this routine: https://app.example.test/dashboard/signals?routine=routine-1');
  expect(prompt).toContain('MCP: https://api.example.test/api/mcp');
  expect(prompt).toContain('A working MCP connection is sufficient');
  expect(prompt).toContain('exact authorization URL directly in this chat');
  expect(prompt).toContain('Never substitute the routine return link');
  expect(prompt).toContain('resume this same task');
  expect(prompt).toContain('one [Review routine]');
  expect(prompt).toContain('OAuth access enables tools; it does not authorize activation');
  expect(prompt).toContain('A new routine or copied prompt does not require another login');
  expect(prompt).toContain('CLI profile: o11-workspace-1 (shared by all routines in this workspace)');
  expect(prompt).toContain('--profile o11-workspace-1 --json');
  expect(prompt).toContain('check the existing default profile');
  expect(prompt).toContain('Never emit HTML tags, including `<details>` or `<summary>`');
  expect(prompt).toContain('Use plain Markdown');
});
test('new setup requires o11 events and additive replay without migrating existing PostHog routines', () => {
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', organizationId: 'workspace', request: 'Watch successful exports and replay failed attempts.' });
  expect(prompt).toContain('use only o11 tracking sources for events and the o11 replay pipeline');
  expect(prompt).toContain('If this routine already uses PostHog, preserve it unless I explicitly request migration');
  expect(prompt).toContain('tracking.replaySession');
  expect(prompt).toContain('@o11/tracking/replay');
  expect(prompt).not.toContain('If an existing provider covers the behavior, configure its source instead');
  const replay = readDoc('replay')!.markdown;
  expect(replay).toContain('Never disable or reconfigure a customer');
  expect(prompt).toContain('Never disable, reconfigure, restart, flush, replace or intercept PostHog');
  expect(prompt).not.toContain('prepare disabling its recorder');
  expect(prompt).toContain('pass its actual instance as the posthog option');
  expect(replay).toContain('Compatibility is based on recording data, not an SDK version allowlist');
  expect(prompt).toContain('SDK versions are diagnostics, not an allowlist or reason to reject setup');
  expect(replay).toContain('An event-only routine does not require a recorder');
  expect(replay).toContain('derives customerId from the signed-in account');
});
test('handoff preserves the exact request, revision and workspace with one MCP/CLI workflow', () => {
  const request = 'Find report creators.\nEmail once; stop on reply.';
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', organizationId: 'workspace-1', routineId: 'routine-1', revision: 7, request });
  expect(prompt.endsWith(request)).toBe(true);
  expect(prompt).toContain('https://api.example.test/api/mcp');
  expect(prompt).toContain('Use the o11 CLI first');
  expect(prompt).toContain('o11 login --server https://api.example.test');
  expect(prompt).toContain('o11 status --json');
  expect(prompt).toContain('Only if the CLI cannot be installed or executed');
  expect(prompt).not.toContain('Prefer an available o11 MCP connection');
  expect(prompt).toContain('Copied revision: 7');
  expect(prompt).toContain('Save an inactive draft');
  expect(prompt).toContain('inspect operation status');
  expect(prompt).toContain('https://api.example.test/dashboard/signals?routine=routine-1');
  expect(prompt).toContain('Do not create a replacement routine');
  expect(prompt).toContain('read that exact routine back');
  expect(prompt).toContain('report setup as incomplete');
  expect(prompt).toContain('Save a setupReport on that same routine');
  expect(prompt).toContain('waiting_for_merge (include the actual pullRequestUrl)');
  expect(prompt).toContain('unsupported behavior');
  expect(prompt).toContain('validate that returned revision');
  expect(prompt).toContain('never invent a PR or infer deployment');
  expect(prompt).toContain('save detection without adding unsolicited messaging');
  expect(prompt).toContain('typed action: clarify_scope');
  expect(prompt).toContain('Leave a new scope resolution unset for me to choose');
  expect(prompt).toContain('do not bypass it');
  expect(prompt).not.toContain('Prepare pull request');
});
test('tracking-only handoffs keep routine configuration out of scope', () => {
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', organizationId: 'workspace-1', routineId: 'routine-1', trackingOnly: true, request: 'Track exports.' });
  expect(prompt).not.toContain('Return to this routine:');
  expect(prompt).not.toContain('Do not create a replacement routine');
  expect(prompt).not.toContain('Save a setupReport');
  expect(prompt).toContain('Do not create, edit or activate a routine.');
});
test('repair handoffs preserve prior failure evidence and require runtime verification', () => {
  const setupReport = {
    revision: 6, checkedAt: '2026-10-06T12:00:00.000Z',
    tracking: { status: 'reused', summary: 'Existing events cover detection.' },
    blockers: [{ title: 'Preview failed', message: 'Circular import prevents module initialization.', owner: 'coding_agent', nextStep: 'Repair the import cycle and rerun preview.' }],
    limitations: ['Follow-up runtime has not been checked.'],
  };
  const request = 'Find report creators.';
  const input = { apiUrl: 'https://api.example.test', organizationId: 'workspace-1', routineId: 'routine-1', revision: 7, request, setupReport };
  const prompt = setupPrompt(input);
  expect(prompt).toContain('Saved setup evidence (revision 6');
  expect(prompt).toContain('recheck against current state');
  expect(prompt).toContain(JSON.stringify(setupReport, null, 2));
  expect(prompt).toContain('even when they predate your changes');
  expect(prompt).toContain('execute the affected runtime path');
  expect(prompt).toContain('Do not mark setup complete while a required check fails or remains unverified');
  expect(prompt.endsWith(request)).toBe(true);
  const tracking = setupPrompt({ ...input, trackingOnly: true });
  expect(tracking).not.toContain('Saved setup evidence');
  expect(tracking).toContain('Do not create, edit or activate a routine.');
});
test('documentation is discoverable, bounded and covers complete setup', () => {
  expect(new Set(agentDocs.map(doc => doc.id)).size).toBe(agentDocs.length);
  expect(searchDocs('PostgreSQL').map(doc => doc.id)).toContain('sources');
  expect(readDoc('missing')).toBeUndefined();
  expect(agentDocs.every(doc => doc.markdown.length < 20000)).toBe(true);
});
test('routine and tracking handoffs ask for clarification without guessing requirements', () => {
  for (const trackingOnly of [false, true]) {
    const request = 'Watch users who stopped using reports.';
    const prompt = setupPrompt({ apiUrl: 'https://api.example.test', organizationId: 'workspace-1', request, trackingOnly });
    expect(prompt).toContain('ask me concise questions before making the affected changes');
    expect(prompt).toContain('Do not guess missing requirements');
    expect(prompt).toContain('continue only work that does not depend on my answers');
    expect(prompt.endsWith(request)).toBe(true);
  }
});
test('handoff and guides support independently published CLI and tracking versions', async () => {
  const cli: { version: string } = await Bun.file(new URL('../../cli/package.json', import.meta.url)).json();
  expect(cliVersion).toBe(cli.version);
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', organizationId: 'workspace-1', request: 'Configure tracking.' });
  expect(prompt).toContain(`CLI version: ${cliVersion}`);
  expect(prompt).toContain(`Tracking SDK version: ${agentKitVersion}`);
  expect(prompt).toContain(`@o11/cli@${cliVersion}`);
  expect(prompt).toContain(`@o11/tracking@${agentKitVersion}`);
  expect(readDoc('setup')?.markdown).toContain(`@o11/cli@${cliVersion}`);
  expect(readDoc('cli')?.markdown).toContain(`@o11/cli@${cliVersion}`);
  expect(readDoc('tracking')?.markdown).toContain(`@o11/tracking@${agentKitVersion}`);
  expect(readDoc('cli')?.markdown).toContain("CLI's bundled documentation snapshot");
  expect(readDoc('cli')?.markdown).toContain('o11 call o11_docs --input FILE');
});
test('installation handoff is source specific and preserves repository approval boundaries', () => {
  const prompt=setupPrompt({apiUrl:'https://example.test',organizationId:'org',trackingOnly:true,trackingSourceId:'source-1',request:'Instrument actual successful orders.'});
  for (const required of ['AGENTS.md','Tracking source: source-1','Tracking endpoint: https://example.test/api/tracking/events','environment=test','durable application outbox','recorded channel/purpose permissions','continuous coverage','repository approval']) expect(prompt).toContain(required);
  expect(prompt).toContain('Do not create, edit or activate a routine');
});

test('remote handoff checks the host and finishes code submission before reporting a connection', () => {
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', organizationId: 'workspace-1', request: 'Track Excel sessions.' });
  expect(prompt).toContain('check whether this agent runs on a VM');
  expect(prompt).toContain('keep that process running');
  expect(prompt).toContain('o11 login --input FILE|-');
  expect(prompt).toContain('Verify o11 status before saying the connection is complete');
  for (const id of ['setup', 'cli']) {
    const doc = readDoc(id)!.markdown;
    expect(doc).toContain('o11 login --input FILE|-');
    expect(doc).toContain('before');
    expect(doc).toContain('o11 status');
  }
});

test('setup investigates history through o11 and separates one-off verification from monitoring', () => {
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', organizationId: 'org', request: 'Email users with five messages in their first Excel session.' });
  for (const requirement of ['Use only o11 MCP/CLI', 'signals_previewEvents', 'research_sessions', 'sessions with zero requested actions', 'Look beyond the candidate preview window', 'one-off historical query does not implement automatic monitoring', 'read releases back']) expect(prompt).toContain(requirement);
  const guide = readDoc('history')!;
  expect(searchDocs('historical').map(doc => doc.id)).toContain('history');
  expect(guide.markdown).toContain('o11 reads its configured sources on the server');
  expect(guide.markdown).toContain('research_report');
  expect(guide.markdown).toContain('a zero-message first session');
  expect(prompt).toContain('Read scheduled/manual import availability and job progress/errors');
  expect(prompt).toContain('paused, unavailable or finished');
  expect(prompt).toContain('Do not ask me to "confirm complete history."');
  expect(guide.markdown).toContain('Say earlier sessions are loading only when the source reports an active import');
  expect(guide.markdown).toContain('first-session monitoring needs hourly imports');
  expect(guide.markdown).toContain('fresh signals.previewEvents call');
  expect(guide.markdown).toContain('analytics_continueImport');
  expect(guide.markdown).toContain('require o11:send');
  expect(guide.markdown).toContain('more:false can also mean a lease, due-time or provider error');
});
