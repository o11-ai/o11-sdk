import type { ReplayEvent } from './replay-contract';
const safeAttributes = new Set(['class', 'type', 'role', 'disabled', 'checked', 'selected', 'hidden', 'open', 'width', 'height', 'style', 'rel', 'media', 'viewBox', 'd', 'fill', 'stroke', 'xmlns',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'pathLength', 'preserveAspectRatio',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'fill-rule', 'fill-opacity', 'stroke-opacity',
  '_cssText', 'rr_width', 'rr_height', 'rr_scrollTop', 'rr_scrollLeft']);
const urlAttributes = new Set(['src', 'href', 'poster', 'action']);
function privateCss(value: string) {
  return value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_, _quote: string, url: string) => `url("${replayUrl(url)}")`)
    .replace(/@import\s+(['"])(.*?)\1/gi, (_, _quote: string, url: string) => `@import "${replayUrl(url)}"`)
    .replace(/\bcontent\s*:\s*[^;}]+/gi, 'content: "[masked]"');
}
export function replayUrl(value: string) {
  try { const url = new URL(value, typeof location === 'undefined' ? 'https://redacted.invalid' : location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  } catch { return ''; }
}
// rrweb handles DOM/input text masking. This additional boundary removes
// arbitrary attribute values and URL query credentials before buffering.
export function privateReplayEvent(event: ReplayEvent): ReplayEvent {
  function clean(value: unknown, depth = 0, stylesheet = false): unknown {
    if (depth > 100) throw new Error('Recording exceeds supported DOM depth.');
    if (Array.isArray(value)) return value.map(item => clean(item, depth + 1, stylesheet));
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    const cssNode = stylesheet || ('tagName' in value && value.tagName === 'style');
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'attributes' && entry && typeof entry === 'object' && !Array.isArray(entry)) {
        result[key] = Object.fromEntries(Object.entries(entry).filter(([name]) => safeAttributes.has(name) || urlAttributes.has(name))
          .map(([name, item]) => [name, typeof item === 'string' ? urlAttributes.has(name) ? replayUrl(item) : ['style', '_cssText'].includes(name) ? privateCss(item) : item : item]));
      } else if (['href', 'url'].includes(key) && typeof entry === 'string') result[key] = replayUrl(entry);
      else if (['_cssText', 'cssText', 'rule'].includes(key) && typeof entry === 'string') result[key] = privateCss(entry);
      else if (key === 'textContent' && cssNode && typeof entry === 'string') result[key] = privateCss(entry);
      else result[key] = clean(entry, depth + 1, cssNode && key === 'childNodes');
    }
    return result;
  }
  return { ...event, data: clean(event.data) };
}
