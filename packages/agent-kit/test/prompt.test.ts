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
  expect(prompt).not.toContain('Prepare pull request');
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
});
test('installation handoff is source specific and preserves repository approval boundaries', () => {
  const prompt=setupPrompt({apiUrl:'https://example.test',organizationId:'org',trackingOnly:true,trackingSourceId:'source-1',request:'Instrument actual successful orders.'});
  for (const required of ['AGENTS.md','Tracking source: source-1','Tracking endpoint: https://example.test/api/tracking/events','environment=test','durable application outbox','recorded channel/purpose permissions','continuous coverage','repository approval']) expect(prompt).toContain(required);
  expect(prompt).toContain('Do not create, edit or activate a routine');
});
