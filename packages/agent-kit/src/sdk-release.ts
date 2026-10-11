import { agentKitVersion, cliVersion, docsVersion, instructionsVersion, releaseId } from './versions';
import { boundedBytes, npmRegistry, registryCliRelease, stableVersion, type ReleaseRequest } from './cli-release';

/** Append release records; never rewrite a released record to describe new behavior. */
export const releaseHistory = [{
  id: '2026-10-10.1', preparedAt: '2026-10-10', cliVersion: '0.2.11', trackingVersion: '0.2.8',
  docsVersion: '1', instructionsVersion: '1', apiVersion: '1', trackingFormatVersion: 1,
  changes: [
    'Prefer verified upgrades during setup, while preserving working customer changes.',
    'Inspect installed packages separately from running application evidence.',
    'Save version, upgrade, verification and temporary exception records.',
    'Keep release notes and upgrade instructions available to people and agents.',
    'Correct shared recording privacy guidance; retain existing consent and masking choices.',
  ],
  upgrade: [
    'Read the upgrades guide and inspect the existing app, source, environment and repository instructions.',
    'Run o11 upgrade plan in each application. Use the verified server release, not an unverified latest tag.',
    'Update the command tool and SDK with the permitted installation method when the change is straightforward.',
    'Review custom changes, event meaning, capture privacy and every routine using shared tracking.',
    'Keep pending events and receipts, stable IDs, existing sources, credentials and disabled settings.',
    'Verify the deployed app, real processed activity, matching and excluded examples, then save the setup record.',
  ],
  recovery: 'Restore the previous dependency and app commit after checking service support. Keep pending delivery IDs. Sent messages, deleted history and newly collected data cannot be undone by reinstalling a package.',
}] as const;

export const supportPolicy = {
  preferred: 'server_verified_release',
  previousReleaseNoticeDays: 180,
  sunset: [] as Array<{ package: '@o11/cli' | '@o11/tracking'; below: string; announcedAt: string; supportEndsAt: string }>,
  exceptions: 'Keep a working older installation temporarily with a reason, owner, next action and review date. Recheck within 30 days; a review date never stops capture automatically.',
  enforcement: 'Advisory. No version-based rejection of existing tracking or automatic customer messaging changes.',
  scope: 'Newer releases receive fixes. Older installations receive upgrade help; no indefinite promise to backport fixes. Retirement requires a published notice and at least 180 days, except a separately reviewed urgent security response.',
} as const;

export function releaseRecord(id = releaseId) { return releaseHistory.find(record => record.id === id); }
export function releaseMetadata() {
  const release = releaseRecord();
  if (!release || release.cliVersion !== cliVersion || release.trackingVersion !== agentKitVersion || release.docsVersion !== docsVersion || release.instructionsVersion !== instructionsVersion)
    throw new Error('The current version pins need a matching permanent release record.');
  return { formatVersion: 1, release, support: supportPolicy,
    requirements: { events: { trackingFormatVersion: 1 }, replay: { trackingFormatVersion: 1 },
      setupRecords: { cliVersion, instructionsVersion, docsVersion } },
    limitations: ['Release requirements do not prove source access, deployment, history coverage, recording consent, worker health or contact permission.'] };
}
export async function publishedSdkRelease(request: ReleaseRequest = fetch) {
  const cli = await registryCliRelease(cliVersion, request, { releaseId, docsVersion, instructionsVersion });
  const response = await request(`${npmRegistry}/@o11%2ftracking/${agentKitVersion}`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('The tracking release is not available. Retry later.');
  const value: unknown = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 128 * 1024)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tracking release metadata.');
  const data = value as Record<string, unknown>, dist = data.dist;
  if (data.name !== '@o11/tracking' || data.version !== agentKitVersion || !stableVersion.test(agentKitVersion)
    || !dist || typeof dist !== 'object' || Array.isArray(dist)) throw new Error('Tracking release identity mismatch.');
  const artifact = dist as Record<string, unknown>;
  const identity = data.o11Release;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
    || (identity as Record<string, unknown>).releaseId !== releaseId
    || (identity as Record<string, unknown>).docsVersion !== docsVersion
    || (identity as Record<string, unknown>).instructionsVersion !== instructionsVersion) throw new Error('Tracking package and guide release identities disagree.');
  if (artifact.tarball !== `${npmRegistry}/@o11/tracking/-/tracking-${agentKitVersion}.tgz`
    || typeof artifact.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(artifact.integrity)) throw new Error('Tracking release integrity is unavailable.');
  return { ...releaseMetadata(), available: true, packages: { cli, tracking: {
    package: '@o11/tracking', version: agentKitVersion, tarball: artifact.tarball, integrity: artifact.integrity,
  } } };
}
export type PublishedSdkRelease = Awaited<ReturnType<typeof publishedSdkRelease>>;
