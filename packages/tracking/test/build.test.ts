import { expect, test } from 'bun:test';

test('published SDK preserves runtime environment checks rather than the build environment', () => {
  const cwd = new URL('../', import.meta.url).pathname;
  const build = Bun.spawnSync([process.execPath, '--no-env-file', 'build.ts'], { cwd, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'development' } });
  expect(build.exitCode).toBe(0);
  for (const runtime of ['production', 'development', 'test']) for (const environment of ['production', 'test']) {
    const script = `import { createTrackingClient } from './dist/index.js'; try { createTrackingClient({endpoint:'http://localhost:5101/api/tracking/events',key:'disposable-test',environment:${JSON.stringify(environment)}}); } catch { process.exit(4); }`;
    const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], { cwd, env: { PATH: process.env.PATH ?? '', NODE_ENV: runtime } });
    expect(result.exitCode).toBe(environment === 'production' && runtime !== 'production' ? 4 : 0);
  }
}, 10000);
