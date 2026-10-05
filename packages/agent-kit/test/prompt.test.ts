import { expect, test } from 'bun:test';
import { setupPrompt } from '../src/prompt';
import { agentKitVersion, cliVersion } from '../src/prompt';
import { agentDocs, searchDocs, readDoc } from '../src/docs';
test('handoff preserves the exact request, revision and workspace with one MCP/CLI workflow', () => {
  const request = 'Find report creators.\nEmail once; stop on reply.';
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', organizationId: 'workspace-1', routineId: 'routine-1', revision: 7, request });
  expect(prompt.endsWith(request)).toBe(true);
  expect(prompt).toContain('https://api.example.test/api/mcp');
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
test('handoff and guides support independently published CLI and tracking versions', () => {
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
