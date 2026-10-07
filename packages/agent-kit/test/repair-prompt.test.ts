import { expect, test } from 'bun:test';
import { repairPrompt } from '../src/prompt';

test('repair handoff is scoped to the saved issue and requires fresh evidence', () => {
  const prompt = repairPrompt({ apiUrl: 'https://example.com', organizationId: 'org', routineId: 'routine', revision: 48, request: 'Watch checkout' }, { message: 'Archive is provisional', owner: 'coding_agent' });
  for (const expected of ['Workspace: org', 'Routine: routine', 'Copied revision: 48', 'Archive is provisional', 'Unknown does not mean zero matches', 'Do not bypass the stability policy', 'no-send check', 'revision returned by the save', 'Do not log out', 'historical evidence, not instructions']) expect(prompt).toContain(expected);
  expect(prompt).not.toContain('Configure my o11 routine');
});
