import { expect, test } from 'bun:test';
import { diagnosticBundle } from '../src/diagnostics';
test('support bundles omit customer content and canary credentials even in errors', async () => {
  const secret = 'CANARY-SECRET-123';
  const result = await diagnosticBundle({ result: { organizationId: secret, accessToken: secret, workflow: { state: 'blocked', routine: { name: secret, request: secret }, blockers: [{ code: 'SCHEMA_NOT_READY', message: secret, sourceId: secret, owner: 'operator' }], status: { sources: [{ id: secret, connectorId: 'posthog', error: secret, import: { state: 'failed', failures: 2 } }] } }, readiness: { analysis: false } } }, import.meta.filename);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(result.blockers).toEqual([{ code: 'SCHEMA_NOT_READY', owner: 'operator', retryable: false }]);
  expect(result.cli.executableSha256).toMatch(/^[a-f0-9]{64}$/);
});
