import { REPLAY_LIMITS, type ReplayEvent } from './replay-contract';
import { replayUrl } from './replay-privacy';
export const POSTHOG_REPLAY_TESTED_VERSIONS = ['1.297.4', '1.335.2', '1.438.1', '1.438.3'] as const;
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
// PostHog owns DOM text/attribute masking. Preserve its rendering data, including
// CSS, selectors and asset URLs, rather than applying native capture's policy a
// second time. Only rrweb visual events cross this boundary; never plugins/logs.
const visualFields: Record<number, readonly string[]> = {
  1: ['positions'], 2: ['type', 'id', 'x', 'y', 'pointerType'], 3: ['id', 'x', 'y'], 4: ['width', 'height'],
  5: ['id', 'text', 'isChecked', 'userTriggered'], 6: ['positions'],
  7: ['type', 'id', 'currentTime', 'volume', 'muted', 'loop', 'playbackRate'],
  8: ['id', 'styleId', 'adds', 'removes', 'replace', 'replaceSync'],
  10: ['family', 'fontSource', 'buffer', 'descriptors'], 12: ['positions'],
  13: ['id', 'styleId', 'index', 'set', 'remove'], 14: ['ranges'],
  15: ['id', 'styles', 'styleIds'], 16: ['define'],
};
const pick = (raw: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter(key => raw[key] !== undefined).map(key => [key, structuredClone(raw[key])]));
export function posthogCopyPrivacy() {
  const blocked = new Set<number>(), parents = new Map<number, number>(), children = new Map<number, Set<number>>(), tags = new Map<number, string>();
  const exclude = (id: number) => {
    blocked.add(id);
    const pending = [id];
    for (let index = 0; index < pending.length; index++) for (const child of children.get(pending[index]!) ?? [])
      if (!blocked.has(child)) { blocked.add(child); pending.push(child); }
  };
  const attributesCopy = (raw: Record<string, unknown>, tag: string) => {
    const attributes = Object.fromEntries(Object.entries(raw).filter(([key]) => !/^on/i.test(key) && key !== 'srcdoc' && !(tag === 'iframe' && key === 'src')));
    // Never expose form values even when an upstream project disables masking.
    if (['input', 'textarea'].includes(tag) && 'value' in attributes) attributes.value = '[masked]';
    return attributes;
  };
  const nodeCopy = (raw: unknown, parent?: number, depth = 0): unknown => {
    if (depth > 100) throw new Error('Recording DOM too deep.');
    const node = object(raw), attributes = node.attributes ? object(node.attributes) : {}, id = Number(node.id);
    const tag = String(node.tagName ?? '').toLowerCase();
    if (parent !== undefined) {
      const previous = parents.get(id); if (previous !== undefined && previous !== parent) children.get(previous)?.delete(id);
      parents.set(id, parent); const siblings = children.get(parent) ?? new Set<number>(); siblings.add(id); children.set(parent, siblings);
    }
    tags.set(id, tag);
    if (tags.size > 100_000) throw new Error('Recording DOM state exceeds limit.');
    const excluded = blocked.has(id) || (parent !== undefined && blocked.has(parent)) || 'data-o11-block' in attributes || String(attributes.class ?? '').split(/\s+/).some(name => ['rr-block', 'ph-no-capture'].includes(name));
    const clean = pick(node, ['type', 'id', 'name', 'publicId', 'systemId', 'tagName', 'isSVG', 'isCustom', 'needBlock', 'isShadow', 'isShadowHost', 'rootId', 'compatMode', 'textContent', 'isStyle']);
    if (excluded) {
      if (parent !== undefined && blocked.has(parent)) blocked.add(id); else exclude(id);
      if (Array.isArray(node.childNodes)) for (const child of node.childNodes) nodeCopy(child, id, depth + 1);
      return { type: 2, id, tagName: 'div', attributes: pick(attributes, ['class', 'rr_width', 'rr_height', 'width', 'height']), childNodes: [] };
    }
    if (tag === 'script') clean.tagName = 'noscript';
    if (node.type === 3 && parent !== undefined && tags.get(parent) === 'textarea') clean.textContent = '[masked]';
    if (node.attributes) clean.attributes = attributesCopy(attributes, tag);
    if (Array.isArray(node.childNodes)) clean.childNodes = node.childNodes.map(child => nodeCopy(child, id, depth + 1));
    return clean;
  };
  return (event: ReplayEvent): ReplayEvent | null => {
    const raw = object(event.data); let data: Record<string, unknown>;
    if (event.type === 2) {
      blocked.clear(); parents.clear(); children.clear(); tags.clear();
      data = { node: nodeCopy(raw.node), initialOffset: pick(object(raw.initialOffset), ['left', 'top']) };
    } else if (event.type === 4) data = { ...pick(raw, ['width', 'height']), href: typeof raw.href === 'string' ? replayUrl(raw.href) : '' };
    else if (event.type === 0 || event.type === 1) data = {};
    else if (event.type === 3) {
      if (raw.source === 0) {
        const list = (key: string) => { if (!Array.isArray(raw[key])) throw new Error('Invalid recording mutation.'); return raw[key].map(object); };
        const attributes = list('attributes');
        for (const item of attributes) {
          const attrs = object(item.attributes);
          if ('data-o11-block' in attrs || String(attrs.class ?? '').split(/\s+/).some(name => ['rr-block', 'ph-no-capture'].includes(name))) exclude(Number(item.id));
        }
        data = { source: 0, ...pick(raw, ['isAttachIframe']),
          adds: list('adds').map(item => ({ parentId: item.parentId, ...pick(item, ['nextId', 'previousId']), node: nodeCopy(item.node, Number(item.parentId)) })).filter(item => !blocked.has(Number(item.parentId))),
          texts: list('texts').filter(item => !blocked.has(Number(item.id))).map(item => ({ id: item.id, value: tags.get(parents.get(Number(item.id)) ?? -1) === 'textarea' ? '[masked]' : item.value })),
          attributes: attributes.filter(item => !blocked.has(Number(item.id))).map(item => ({ id: item.id, attributes: attributesCopy(object(item.attributes), tags.get(Number(item.id)) ?? '') })),
          // Keep removals so deleting a blocked placeholder still removes it.
          removes: list('removes').map(item => pick(item, ['parentId', 'id', 'isShadow'])) };
      } else {
        const fields = visualFields[Number(raw.source)];
        if (!fields || blocked.has(Number(raw.id))) return null;
        data = { source: raw.source, ...pick(raw, fields) };
        if ([1, 6, 12].includes(Number(raw.source)) && Array.isArray(data.positions))
          data.positions = data.positions.map(object).filter(position => !blocked.has(Number(position.id)));
        if (raw.source === 14 && Array.isArray(data.ranges))
          data.ranges = data.ranges.map(object).filter(range => !blocked.has(Number(range.start)) && !blocked.has(Number(range.end)));
        if (raw.source === 5) data.text = '[masked]';
      }
    } else return null;
    return { type: event.type, timestamp: event.timestamp, data };
  };
}
