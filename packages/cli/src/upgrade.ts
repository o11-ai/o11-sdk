import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { boundedBytes, parseCliRelease, stableVersion, npmRegistry, type ReleaseRequest } from '@o11/agent-kit/cli-release';
import { upgradeDecision } from '@o11/agent-kit/upgrade-policy';
import { version } from './version';
import { object } from './http-client';

const planInput = z.object({ repositoryPath: z.string().min(1).max(2000).optional(), customized: z.boolean().optional(),
  organizationId: z.string().optional(), environment: z.enum(['test', 'production']).optional() }).strict();
const releaseInput = z.object({ formatVersion: z.literal(1), available: z.literal(true),
  release: z.object({ id: z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/), cliVersion: z.string(), trackingVersion: z.string(),
    instructionsVersion: z.string().max(100), docsVersion: z.string().max(100), apiVersion: z.literal('1'),
    changes: z.array(z.string().max(2000)).max(50), upgrade: z.array(z.string().max(2000)).max(50), recovery: z.string().max(4000) }),
  packages: z.object({ cli: z.unknown(), tracking: z.object({ package: z.literal('@o11/tracking'), version: z.string().regex(stableVersion),
    tarball: z.string(), integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/) }) }),
  support: z.object({ previousReleaseNoticeDays: z.number().int().min(180), exceptions: z.string().max(4000), scope: z.string().max(4000),
    sunset: z.array(z.object({ package: z.enum(['@o11/cli', '@o11/tracking']), below: z.string().regex(stableVersion), announcedAt: z.iso.datetime(), supportEndsAt: z.iso.datetime() })).max(100) }),
});

/** Read package metadata only; never import or execute customer package code. */
export async function installedTracking(repositoryPath: string) {
  const root = await realpath(resolve(repositoryPath)), manifestPath = join(root, 'package.json');
  const info = await stat(manifestPath);
  if (!info.isFile() || info.size > 1_048_576) throw new Error('Choose the actual application directory containing a regular package.json of at most 1 MiB.');
  const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!object(value)) throw new Error('The application package metadata is invalid.');
  const dependencies = { ...(object(value.dependencies) ? value.dependencies : {}), ...(object(value.devDependencies) ? value.devDependencies : {}) };
  const requested = typeof dependencies['@o11/tracking'] === 'string' ? dependencies['@o11/tracking'] : null;
  let packagePath: string | null = null, installedVersion: string | null = null;
  try {
    const require = createRequire(manifestPath);
    let directory = dirname(await realpath(require.resolve('@o11/tracking')));
    for (let count = 0; count < 12; count++) {
      try {
        const path = join(directory, 'package.json'), size = await stat(path);
        if (size.isFile() && size.size <= 1_048_576) {
          const metadata: unknown = JSON.parse(await readFile(path, 'utf8'));
          if (object(metadata) && metadata.name === '@o11/tracking' && typeof metadata.version === 'string') { installedVersion = metadata.version; packagePath = path; break; }
        }
      } catch { /* Try the enclosing package directory. */ }
      const parent = dirname(directory); if (parent === directory) break; directory = parent;
    }
  } catch { /* A declared package may not yet be installed; represent it as unknown. */ }
  return { repositoryPath: root, requested, installedVersion, packagePath,
    customized: !!requested && /^(file:|link:|workspace:|git\+|https?:|github:)/.test(requested),
    limitations: ['This checks one selected application. Inspect other apps, wrappers and copied SDKs separately.', 'Installed metadata is not proof of the running package or unmodified package contents.'] };
}

export async function upgradePlan(raw: unknown, server: URL, request: ReleaseRequest = fetch) {
  const input = planInput.parse(raw), installed = await installedTracking(input.repositoryPath ?? process.cwd());
  const response = await request(new URL('/api/agent-docs/release', server), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('The verified release is unavailable. Keep the working installation, continue independent discovery and retry this read.');
  const release = releaseInput.parse(JSON.parse(new TextDecoder().decode(await boundedBytes(response, 128 * 1024))));
  const cli = parseCliRelease(release.packages.cli), tracking = release.packages.tracking;
  if (cli.version !== release.release.cliVersion || tracking.version !== release.release.trackingVersion
    || tracking.tarball !== `${npmRegistry}/@o11/tracking/-/tracking-${tracking.version}.tgz`)
    throw new Error('Release records and published package identities disagree. Nothing was changed.');
  const decision = upgradeDecision({ current: installed.installedVersion, target: tracking.version, customized: input.customized || installed.customized, sunset: release.support.sunset });
  return { formatVersion: 1, readOnly: true, server: server.origin, checkedAt: new Date().toISOString(), installed,
    release: release.release, packages: release.packages, cli: upgradeDecision({ current: version, target: cli.version, package: '@o11/cli', sunset: release.support.sunset }),
    sdk: { ...decision, ...(!installed.requested ? { decision: 'inspect', reason: 'This app does not directly declare the SDK. Inspect shared wrappers and other apps before editing dependencies.' } : {}) },
    support: release.support, nextSteps: release.release.upgrade,
    verification: { installed: installed.installedVersion !== null, deployed: false, received: false, matching: false, excluded: false },
    limitations: ['The plan never edits dependencies, logs in, deploys, changes routines, enables recording or sends messages.', 'Review all crossed release notes and shared consumers before applying the permitted upgrade.', 'Custom modifications and running versions require separate evidence. Unknown is never treated as verified.'] };
}
