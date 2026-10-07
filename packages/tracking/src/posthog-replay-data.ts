import { REPLAY_LIMITS, type ReplayEvent } from './replay-contract';
import { privateReplayEvent } from './replay-privacy';
export const POSTHOG_REPLAY_TESTED_VERSIONS = ['1.335.2', '1.438.1'] as const;
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recording object.');
  return value as Record<string, unknown>;
};
async function inflate(value: string) {
  const reader = new Blob([Uint8Array.from(value, character => character.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts: ArrayBuffer[] = []; let size = 0;
  try { while (true) { const result = await reader.read(); if (result.done) break; size += result.value.byteLength;
    if (size > REPLAY_LIMITS.snapshotBytes) throw new Error('Recording expansion exceeds limit.'); parts.push(Uint8Array.from(result.value).buffer); }
  } finally { await reader.cancel(); }
  return JSON.parse(await new Blob(parts).text()) as unknown;
}
export async function decodePostHogEvent(value: unknown): Promise<ReplayEvent> {
  const raw = object(value);
  if (!Number.isInteger(raw.type) || Number(raw.type) < 0 || Number(raw.type) > 6 || !Number.isFinite(raw.timestamp) || Number(raw.timestamp) < 0) throw new Error('Unsupported recording event.');
  if (raw.cv !== undefined && raw.cv !== '2024-10') throw new Error('Unsupported recording compression.');
  let data = raw.data;
  if (raw.cv === '2024-10') {
    if (raw.type === 2 && typeof data === 'string') data = await inflate(data);
    else if (raw.type === 3) {
      const decoded = { ...object(data) };
      for (const key of decoded.source === 0 ? ['texts', 'attributes', 'removes', 'adds'] : decoded.source === 8 ? ['adds', 'removes'] : [])
        if (typeof decoded[key] === 'string') decoded[key] = await inflate(decoded[key]);
      data = decoded;
    }
  }
  return { type: Number(raw.type), timestamp: Number(raw.timestamp), data: object(data) };
}
// Construct an allowlisted copy. Never mutate PostHog's payload. Plugin, canvas,
// network, console, stylesheet and custom payloads are outside this surface.
export function posthogCopyPrivacy() {
  const blocked = new Set<number>();
  const remember = (raw: unknown, depth = 0) => {
    if (depth > 100) throw new Error('Recording DOM too deep.');
    const node = object(raw); if (typeof node.id === 'number') blocked.add(node.id);
    if (blocked.size > 100_000) throw new Error('Blocked DOM state exceeds limit.');
    if (Array.isArray(node.childNodes)) for (const child of node.childNodes) remember(child, depth + 1);
  };
  const nodeCopy = (raw: unknown, depth = 0): unknown => {
    if (depth > 100) throw new Error('Recording DOM too deep.');
    const node = object(raw), attributes = node.attributes ? object(node.attributes) : {};
    const excluded = 'data-o11-block' in attributes || ['canvas', 'video', 'audio', 'iframe', 'script', 'style'].includes(String(node.tagName)) || String(attributes.class ?? '').split(/\s+/).includes('rr-block');
    if (excluded) { remember(node); return { type: 2, id: node.id, tagName: 'div', attributes: {}, childNodes: [] }; }
    const clean: Record<string, unknown> = {};
    for (const key of ['type', 'id', 'tagName', 'isSVG', 'isShadow', 'rootId', 'compatMode']) if (node[key] !== undefined) clean[key] = node[key];
    if (node.type === 1) { clean.name = 'html'; clean.publicId = ''; clean.systemId = ''; }
    if ('textContent' in node) clean.textContent = '[masked]';
    // o11's attribute boundary is applied below, with styles omitted for shared
    // recordings to exclude hidden CSS text and embedded data.
    if (node.attributes) clean.attributes = Object.fromEntries(Object.entries(attributes).filter(([key]) => !['style', '_cssText'].includes(key)));
    if (Array.isArray(node.childNodes)) clean.childNodes = node.childNodes.map(child => nodeCopy(child, depth + 1));
    return clean;
  };
  const numeric = (raw: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(key => typeof raw[key] === 'number' || typeof raw[key] === 'boolean').map(key => [key, raw[key]]));
  return (event: ReplayEvent): ReplayEvent | null => {
    const raw = object(event.data); let data: Record<string, unknown>;
    if (event.type === 2) { blocked.clear(); data = { node: nodeCopy(raw.node), initialOffset: numeric(object(raw.initialOffset), ['left', 'top']) }; }
    else if (event.type === 4) data = { ...numeric(raw, ['width', 'height']), href: typeof raw.href === 'string' ? new URL(raw.href).origin : '' };
    else if (event.type === 0 || event.type === 1) data = {};
    else if (event.type === 3) {
      if (raw.source === 0) {
        const list = (key: string) => { if (!Array.isArray(raw[key])) throw new Error('Invalid recording mutation.'); return raw[key].map(object); };
        data = { source: 0,
          texts: list('texts').filter(item => !blocked.has(Number(item.id))).map(item => ({ id: item.id, value: '[masked]' })),
          attributes: list('attributes').filter(item => !blocked.has(Number(item.id))).map(item => ({ id: item.id, attributes: Object.fromEntries(Object.entries(object(item.attributes)).filter(([key]) => !['style', '_cssText'].includes(key))) })),
          removes: list('removes').filter(item => !blocked.has(Number(item.id))).map(item => numeric(item, ['parentId', 'id'])),
          adds: list('adds').filter(item => !blocked.has(Number(item.parentId))).map(item => ({ ...numeric(item, ['parentId', 'nextId', 'previousId']), node: nodeCopy(item.node) })) };
      } else if ([2, 3, 4, 5].includes(Number(raw.source))) {
        if (blocked.has(Number(raw.id))) return null;
        data = numeric(raw, ['source', 'type', 'id', 'x', 'y', 'width', 'height', 'isChecked']);
        if (raw.source === 5) data.text = '[masked]';
      } else return null;
    } else return null;
    return privateReplayEvent({ type: event.type, timestamp: event.timestamp, data });
  };
}
