import { expect, test } from 'bun:test';
test('published executable bundles private workspace docs and runs offline', async () => {
  const path = new URL('../dist/index.js', import.meta.url).pathname;
  const source = await Bun.file(path).text();
  expect(source).not.toContain('from "@o11/agent-kit/');
  for (const args of [['--version'], ['docs', 'tracking']]) {
    const command = Bun.spawn(['bun', path, ...args], { cwd: '/tmp', stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(command.stdout).text();
    expect(await command.exited).toBe(0);
    const result: unknown = JSON.parse(output);
    expect(result).toBeObject();
    if (args[0] === 'docs') expect(output).toContain('createTrackingClient');
  }
});
