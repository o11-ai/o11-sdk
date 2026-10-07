export type ReleaseRequest = (url: string | URL, init?: RequestInit) => Promise<Response>;
export const npmRegistry = 'https://registry.npmjs.org';
export const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export type CliRelease = { package: '@o11/cli'; version: string; tarball: string; integrity: string; bundleSha256: string };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CLI release metadata.');
  return value as Record<string, unknown>;
}
export function parseCliRelease(value: unknown): CliRelease {
  const data = record(value);
  if (data.package !== '@o11/cli' || typeof data.version !== 'string' || !stableVersion.test(data.version)
    || data.tarball !== `${npmRegistry}/@o11/cli/-/cli-${data.version}.tgz`
    || typeof data.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(data.integrity)
    || typeof data.bundleSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.bundleSha256)) throw new Error('Invalid CLI release metadata.');
  return { package: '@o11/cli', version: data.version, tarball: data.tarball, integrity: data.integrity, bundleSha256: data.bundleSha256 };
}
export async function registryCliRelease(version: string, request: ReleaseRequest = fetch): Promise<CliRelease> {
  if (!stableVersion.test(version)) throw new Error('Invalid CLI version.');
  const response = await request(`${npmRegistry}/@o11%2fcli/${version}`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`CLI release unavailable (registry HTTP ${response.status}).`);
  const data = record(JSON.parse(new TextDecoder().decode(await boundedBytes(response, 128 * 1024)))), dist = record(data.dist), release = record(data.o11Release);
  if (data.name !== '@o11/cli' || data.version !== version) throw new Error('Registry returned the wrong CLI release.');
  return parseCliRelease({ package: data.name, version, tarball: dist.tarball, integrity: dist.integrity, bundleSha256: release.bundleSha256 });
}

export async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty release response.');
  const parts: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error('Release response exceeds its size limit.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
