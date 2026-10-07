import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { version } from './version';
import { object } from './http-client';

/** Support output is allowlisted: source prompts, customer records and credentials never enter the bundle. */
export async function diagnosticBundle(snapshot: unknown, executable = process.argv[1]) {
  const result = object(snapshot) && object(snapshot.result) ? snapshot.result : {};
  const workflow = object(result.workflow) ? result.workflow : {};
  const verification = object(workflow.verification) ? workflow.verification : {};
  const status = object(workflow.status) ? workflow.status : {};
  const safe = (value: unknown, pattern = /^[a-zA-Z0-9_.:/-]{1,160}$/) => typeof value === 'string' && pattern.test(value) ? value : null;
  let sha256: string | null = null, distribution = 'unknown';
  if (executable) {
    try {
      const path = await realpath(executable);
      distribution = /[/\\]src[/\\].+\.tsx?$/.test(path) ? 'source' : 'artifact';
      sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
    } catch { /* A missing executable is represented as unknown, not a successful fingerprint. */ }
  }
  const allowedCodes = /^[A-Z][A-Z0-9_]{1,100}$/;
  return { formatVersion: 1, checkedAt: new Date().toISOString(), cli: { version, distribution, executableSha256: sha256,
    runtime: process.versions.bun ? 'bun' : 'node', runtimeVersion: process.versions.bun ?? process.versions.node, platform: process.platform, architecture: process.arch },
    server: object(result.server) ? { apiVersion: safe(result.server.apiVersion), schemaVersion: safe(result.server.schemaVersion), buildId: safe(result.server.buildId) } : { apiVersion: null, schemaVersion: null, buildId: null },
    state: safe(workflow.state), revision: typeof workflow.revision === 'number' ? workflow.revision : null,
    verification: { definition: safe(verification.definition), execution: safe(verification.execution), behavior: safe(verification.behavior) },
    readiness: object(result.readiness) ? Object.fromEntries(Object.entries(result.readiness).filter(([key, value]) => /^[a-zA-Z]{1,60}$/.test(key) && typeof value === 'boolean')) : {},
    blockers: Array.isArray(workflow.blockers) ? workflow.blockers.filter(object).map(item => ({ code: safe(item.code, allowedCodes), owner: ['operator', 'workspace', 'agent'].includes(String(item.owner)) ? item.owner : null, retryable: item.retryable === true })) : [],
    sources: Array.isArray(status.sources) ? status.sources.filter(object).map(source => {
      const current = object(source.import) ? source.import : {};
      return { connectorId: safe(source.connectorId), state: safe(current.state), running: current.running === true,
        failures: typeof current.failures === 'number' ? current.failures : null, lagSeconds: typeof current.lagSeconds === 'number' ? current.lagSeconds : null,
        historyComplete: source.historyComplete === true };
    }) : [],
    limitations: ['Executable checksum identifies this local entry point. A source entry point checksum does not cover its imports.', 'Customer content, raw errors, tokens and workspace identifiers are excluded.'] };
}
