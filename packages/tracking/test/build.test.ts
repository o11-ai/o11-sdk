import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

test('published SDK preserves runtime environment checks rather than the build environment', () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const build = Bun.spawnSync([process.execPath, '--no-env-file', 'build.ts'], { cwd, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'development' } });
  expect(build.exitCode).toBe(0);
  const server = Bun.file(`${cwd}/dist/index.js`), replay = Bun.file(`${cwd}/dist/replay.js`);
  expect(server.size).toBeLessThan(25_000);
  expect(replay.size).toBeLessThan(12_000);
  expect(Bun.spawnSync([process.execPath, '--no-env-file', '-e', "import { createReplayClient } from './dist/replay.js'; const recorder = createReplayClient({endpoint:'https://example.com/api/replay',consent:()=>false,session:async()=>{throw new Error('unused')}}); if(recorder.status !== 'stopped') process.exit(1);"], { cwd, env: { PATH: process.env.PATH ?? '' } }).exitCode).toBe(0);
  for (const runtime of ['production', 'development', 'test']) for (const environment of ['production', 'test']) {
    const script = `import { createTrackingClient } from './dist/index.js'; try { createTrackingClient({endpoint:'http://localhost:5101/api/tracking/events',key:'disposable-test',environment:${JSON.stringify(environment)}}); } catch { process.exit(4); }`;
    const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], { cwd, env: { PATH: process.env.PATH ?? '', NODE_ENV: runtime } });
    expect(result.exitCode).toBe(environment === 'production' && runtime !== 'production' ? 4 : 0);
  }
}, 10000);
