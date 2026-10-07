/** Semver precedence, including prereleases; build metadata never orders releases. */
export function compareReleaseVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
    if (!match) throw new Error('Release version must be valid semver.');
    const pre = match[4]?.split('.');
    if (pre?.some(part => !part || /^0\d+$/.test(part))) throw new Error('Invalid release prerelease.');
    return { core: match.slice(1, 4).map(BigInt), pre };
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i]! > b.core[i]! ? 1 : -1;
  if (!a.pre || !b.pre) return a.pre === b.pre ? 0 : !a.pre ? 1 : -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numericX = /^\d+$/.test(x), numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function updateStatus(currentVersion: string, currentDigest: string, release: { version: string; bundleSha256: string }) {
  const order = compareReleaseVersions(release.version, currentVersion);
  const sameVersionRepair = order === 0 && release.bundleSha256 !== currentDigest;
  return { currentVersion, updateAvailable: order > 0 || sameVersionRepair,
    reason: order > 0 ? 'newer_release' : order < 0 ? 'server_release_older' : sameVersionRepair ? 'bundle_repair' : 'current',
    recovery: order < 0 ? 'Keep the newer CLI. Refresh live docs and command schemas, then retry the affected command. If it still fails, inspect server release availability.' : null };
}
