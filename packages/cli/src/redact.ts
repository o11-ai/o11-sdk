const sensitive = /(?:password|secret|credential|authorization|bearer|^token$|access.?token|refresh.?token|api.?key|private.?key|webhook)/i;
function webhookSecret(value: string): boolean {
  try {
    const url = new URL(value);
    return (["hooks.slack.com", "hooks.slack-gov.com"].includes(url.hostname) && url.pathname.startsWith("/services/"))
      || (["discord.com", "discordapp.com"].includes(url.hostname) && /^\/api(?:\/v\d+)?\/webhooks\//.test(url.pathname));
  } catch { return false; }
}
export function sensitiveValues(value: unknown): string[] {
  if (typeof value === "string") return webhookSecret(value) ? [value] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => sensitive.test(key) && typeof item === 'string' && item.length > 0 ? [item] : sensitiveValues(item));
}
export function redact(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string' && webhookSecret(value)) return '[redacted]';
  if (typeof value === 'string') return secrets.filter(Boolean).reduce((text, secret) => text.replaceAll(secret, '[redacted]'), value);
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '[redacted]' : redact(item, secrets)]));
  return value;
}
