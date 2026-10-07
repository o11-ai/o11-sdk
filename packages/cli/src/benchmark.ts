import { spawn } from 'node:child_process';
import { z } from 'zod';
const inputSchema = z.object({ iterations: z.number().int().min(1).max(20).default(5) }).strict();
export async function benchmarkCli(raw: unknown, executable = process.argv[1]) {
  const input = inputSchema.safeParse(raw);
  if (!input.success || !executable) throw new Error('Benchmark accepts iterations from 1 through 20.');
  const measure = (args: string[]) => new Promise<{ milliseconds: number; bytes: number }>((resolve, reject) => {
    const start = performance.now(); let bytes = 0;
    const child = spawn(process.execPath, [executable, ...args], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000, windowsHide: true });
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; });
    child.once('error', () => reject(new Error('Benchmark process could not start.')));
    child.once('exit', code => code === 0 ? resolve({ milliseconds: performance.now() - start, bytes }) : reject(new Error('Benchmark command failed.')));
  });
  const cases = [];
  for (const [name, args] of [['cold_start', ['--version']], ['offline_docs', ['docs', 'setup']]] as const) {
    const runs = [];
    for (let index = 0; index < input.data.iterations; index++) runs.push(await measure([...args]));
    const times = runs.map(item => item.milliseconds).sort((a, b) => a - b);
    cases.push({ name, runs, medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * 0.95) - 1] });
  }
  return { checkedAt: new Date().toISOString(), runtime: process.versions.bun ? 'bun' : 'node', runtimeVersion: process.versions.bun ?? process.versions.node,
    platform: process.platform, architecture: process.arch, cases,
    limitations: ['Each sample starts a new process; operating-system disk caches remain warm.', 'This offline benchmark excludes authentication, database and provider request time.'] };
}
