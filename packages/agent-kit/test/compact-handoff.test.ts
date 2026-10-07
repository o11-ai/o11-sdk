import { expect, test } from 'bun:test';
import { setupPrompt, repairPrompt } from '../src/prompt';
import { readDoc } from '../src/docs';

test.each([false, true])('handoff preserves exact intent and routes detailed procedures out of chat (trackingOnly=%s)', trackingOnly => {
  const request = 'Watch successful exports.\nStop when the user replies.';
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', frontendUrl: 'https://app.example.test', organizationId: 'workspace', routineId: 'routine', revision: 7, trackingOnly, request });
  expect(prompt.endsWith(request)).toBe(true);
  expect(prompt.length).toBeLessThan(7500);
  expect(prompt).toContain(`docs ${trackingOnly ? 'tracking-workflow' : 'setup-workflow'} --live`);
  expect(prompt).toContain('copied hints, not compatibility gates');
  expect(prompt).toContain('try updating with o11 update before giving up');
  expect(prompt).toContain('returned installation.command');
  expect(prompt).toContain('Never downgrade a newer working CLI');
  expect(prompt).toMatch(/(?:without|do not use) a question tool/);
  expect(prompt).toContain('actual remaining questions at the end');
  expect(prompt).not.toContain('pending grouped question');
  expect(prompt).not.toContain('createReplayClient');
  expect(prompt).not.toContain('monotonically versioned');
  if (trackingOnly) expect(prompt).not.toContain('Ask one grouped question');
  else {
    expect(prompt).toContain('Continue independent discovery and confirmed detection implementation');
    expect(prompt).toContain('Message claims must be supported');
    expect(prompt).toContain('https://app.example.test/dashboard/signals?routine=routine');
  }
});

test('retry handoff references current saved evidence without duplicating historical reports', () => {
  const prompt = setupPrompt({ apiUrl: 'https://api.example.test', organizationId: 'workspace', routineId: 'routine', request: 'Watch exports.', setupReport: {
    revision: 4, checkedAt: '2026-10-07T00:00:00Z', tracking: { status: 'waiting_for_merge', summary: 'x'.repeat(2000) },
    blockers: [{ message: 'x'.repeat(2000), nextStep: 'Inspect current evidence.' }], limitations: [],
  } });
  expect(prompt).toContain('resume unresolved dependencies rather than restarting');
  expect(prompt).not.toContain('x'.repeat(2000));
  for (const page of ['setup-workflow', 'setup-delivery', 'tracking-workflow']) {
    const doc = readDoc(page);
    expect(doc).toBeDefined();
    expect(doc!.markdown.length).toBeLessThan(20000);
  }
  expect(readDoc('setup-workflow')!.markdown).toContain('attempt o11 update');
});

test('scoped repairs also recover version failures and keep questions at the handoff', () => {
  const prompt = repairPrompt({ apiUrl: 'https://api.example.test', organizationId: 'workspace', routineId: 'routine', request: 'Watch exports.' }, { message: 'Provider unavailable.' });
  expect(prompt).toContain('attempt a verified update and retry');
  expect(prompt).toContain('without a question tool');
});
