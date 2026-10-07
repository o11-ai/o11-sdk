import { expect, test } from 'bun:test';
import { detailedSetupPrompt as setupPrompt } from '../src/setup-workflow-guide';
import { readDoc } from '../src/docs';

const request = 'Use our existing PostHog $autocapture and captureReportCommitted wrapper.\nAdd a new event only if these cannot prove a successful export.';
const input = { apiUrl: 'https://example.test', organizationId: 'workspace-7', routineId: 'routine-9', revision: 23, trackingSourceId: 'source-5', request };

test.each([false, true])('copied prompt inventories and reuses handlers before changing instrumentation (trackingOnly=%s)', trackingOnly => {
  const prompt = setupPrompt({ ...input, trackingOnly });
  expect(prompt.endsWith(request)).toBe(true);
  for (const exactContext of ['Workspace: workspace-7', 'Routine: routine-9', 'Copied revision: 23', 'Tracking source: source-5']) expect(prompt).toContain(exactContext);
  expect(prompt).toMatch(/inspect existing analytics SDKs, event handlers, capture calls, wrappers, event constants, schemas and tests/i);
  expect(prompt).toMatch(/signals_sources and signals_resources to compare received events and properties with those handlers/i);
  expect(prompt).toMatch(/map each requested behavior to an o11 source, exact event name, properties and handler location/i);
  expect(prompt).toMatch(/reuse existing o11 events and handlers.*preserve their names, IDs, properties and delivery paths/i);
  expect(prompt).toMatch(/do not double-capture an action within o11/i);
  expect(prompt).toMatch(/reuse the existing successful-operation handler and o11 wrapper/i);
  expect(prompt).toMatch(/install.*if it is not already installed/i);
  expect(prompt).toMatch(/preserve existing analytics delivery for other uses/i);
  expect(prompt).toMatch(/o11 key, profile, outbox and receipt requirements apply only when o11 SDK instrumentation is needed/i);
  expect(prompt.indexOf('Before editing instrumentation')).toBeLessThan(prompt.indexOf('Add instrumentation only for confirmed gaps'));
  expect(prompt).toMatch(/unavailable source, failed discovery, an empty bounded sample or a partial catalog does not prove an event is missing/i);
  expect(prompt).toMatch(/report the unresolved access or evidence check and investigate before changing code/i);
  expect(prompt).toMatch(/smallest draft changes and checks.*create a draft PR when repository access permits/i);
  expect(prompt).toMatch(/PR creation is unavailable.*reviewable diff.*report that no PR exists/i);
  expect(prompt).toMatch(/do not merge, deploy or change production instrumentation without authorization/i);
});

test('routine reuse evidence and unresolved access appear in the same saved routine report', () => {
  const prompt = setupPrompt(input);
  expect(prompt).toContain('https://example.test/dashboard/signals?routine=routine-9');
  expect(prompt).toMatch(/do not create a replacement routine/i);
  expect(prompt).toMatch(/reused provider\/event mappings and any confirmed gaps in tracking.summary/i);
  expect(prompt).toMatch(/unknown coverage or unavailable discovery in limitations and blockers with the next check/i);
  expect(prompt).toMatch(/tracking status reused only when existing received data covers the saved detection/i);
  expect(prompt).toMatch(/waiting_for_merge \(include the actual pullRequestUrl\)/);
  expect(prompt).toMatch(/read the same routine again and validate that returned revision/i);
});

test('tracking-only reuse preserves routine scope and distinguishes unknown checks from confirmed gaps', () => {
  const prompt = setupPrompt({ ...input, trackingOnly: true });
  expect(prompt).toMatch(/do not create, edit or activate a routine/i);
  expect(prompt).toMatch(/discover existing instrumentation first and register only confirmed missing source events/i);
  expect(prompt).toMatch(/report received events, confirmed instrumentation gaps and unresolved discovery checks separately/i);
  expect(prompt).not.toContain('Save a setupReport');
  expect(prompt).not.toContain('Return to this routine:');
});

test('bundled source guides agree on existing instrumentation, replay and explicit identity boundaries', () => {
  for (const page of ['setup', 'tracking']) {
    const text = readDoc(page)?.markdown;
    expect(text).toBeDefined();
    expect(text).toMatch(/existing.*(?:SDKs|analytics).*handlers.*wrappers/i);
    expect(text).toMatch(/draft PR.*reviewable diff/i);
    expect(text).toMatch(/(?:failed discovery|unavailable source|partial catalog).*(?:cannot establish|not proof)/i);
  }
  const sources = readDoc('sources')!.markdown;
  expect(sources).toMatch(/PostHog.*session replay/i);
  expect(sources).toMatch(/@o11\/tracking\/replay provides native session replay/i);
  expect(sources).toMatch(/New routine setup uses o11 events and the o11 replay pipeline/i);
  expect(sources).toContain('sharing existing PostHog replay or using native capture otherwise');
  expect(sources).toMatch(/across sources.*explicit verified links.*external IDs match/i);
});
