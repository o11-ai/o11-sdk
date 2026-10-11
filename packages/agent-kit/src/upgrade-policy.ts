import { supportPolicy } from './sdk-release';

export function versionParts(version: string): number[] | undefined {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return;
  const parts = version.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}
export function compareVersions(left: string, right: string): number | undefined {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) return;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]! ? 1 : -1;
  return 0;
}
export function upgradeDecision(input: { current: string | null; target: string; customized?: boolean; now?: Date;
  package?: '@o11/cli' | '@o11/tracking'; sunset?: typeof supportPolicy.sunset }) {
  const order = input.current ? compareVersions(input.current, input.target) : undefined;
  const current = input.current ? versionParts(input.current) : undefined, target = versionParts(input.target);
  const retirement = (input.sunset ?? supportPolicy.sunset).find(notice => notice.package === (input.package ?? '@o11/tracking') && input.current
    && compareVersions(input.current, notice.below) === -1);
  const support = !retirement ? 'no_retirement_announced' : +(input.now ?? new Date()) >= Date.parse(retirement.supportEndsAt) ? 'upgrade_help_only' : 'retiring';
  const shared = { support, supportEndsAt: retirement?.supportEndsAt ?? null, target: input.target, current: input.current };
  if (order === undefined || !target) return { ...shared, decision: 'inspect' as const, reason: 'Confirm the installed package. Custom, prerelease and unknown versions need review.' };
  if (order > 0) return { ...shared, decision: 'keep_newer' as const, reason: 'Preserve the newer installation and check live service support. Do not downgrade automatically.' };
  if (order === 0) return { ...shared, decision: 'current' as const, reason: 'This package matches the verified service release. Running capture still needs verification.' };
  if (input.customized || current?.[0] !== target[0] || target[0] === 0 && current?.[1] !== target[1])
    return { ...shared, decision: 'review' as const, reason: 'Review customer changes or the changed release series before upgrading. Keep working capture and record a temporary exception if needed.' };
  return { ...shared, decision: 'upgrade' as const, reason: 'Prefer the verified newer release. Review release notes, update with the permitted installation method, run checks and verify real capture.' };
}
