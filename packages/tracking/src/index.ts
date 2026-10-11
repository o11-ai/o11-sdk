import { trackingTransport, type TrackingOptions, type TrackingReceipt } from './transport';
import type { TrackingProfile, TrackingCoverage } from './profile';
import { replaySessionRequest } from './replay-session';
export { sdkVersion } from './version';
import { uploadRecordContent, type JsonValue, type ContentReference, type RecordReference } from './content';
export type { JsonValue, ContentReference, RecordReference } from './content';
export { advanceTrackingDelivery, type DeliveryItem, type DeliveryState } from './delivery';
export type { ReplaySession } from './replay-contract';
export type { TrackingOptions, TrackingReceipt, TrackingFetch, ReceiptStatus } from './transport';
export type { TrackingProfile, TrackingCoverage, ContactChannel } from './profile';
export type TrackingEvent = {
  eventId: string; name: string; customerId?: string; occurredAt: string;
  sessionId?: string; accountId?: string; subject?: { kind: string; id: string };
  references?: RecordReference[]; version?: number; properties?: Record<string, JsonValue>;
};
export function validEvent(input: unknown): input is TrackingEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const event = input as Record<string, unknown>;
  const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 128;
  if (!id(event.eventId) || (event.customerId !== undefined && !id(event.customerId)) || (event.sessionId !== undefined && !id(event.sessionId))) return false;
  if (!event.customerId && !event.accountId && !event.subject) return false;
  if (event.accountId !== undefined && !id(event.accountId) || event.version !== undefined && (!Number.isSafeInteger(event.version) || Number(event.version) < 1 || Number(event.version) > 2147483647)) return false;
  const subject = event.subject as Record<string, unknown> | undefined;
  if (subject !== undefined && (!subject || typeof subject !== 'object' || Array.isArray(subject) || typeof subject.kind !== 'string' || !/^[a-z][a-z0-9_.-]{0,99}$/.test(subject.kind) || typeof subject.id !== 'string' || !subject.id || subject.id.length > 200)) return false;
  if (event.references !== undefined && (!Array.isArray(event.references) || event.references.length > 20 || !event.references.every(value => value && typeof value === 'object' && typeof value.kind === 'string' && /^[a-z][a-z0-9_.-]{0,99}$/.test(value.kind) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200 && (value.relation === undefined || typeof value.relation === 'string' && /^[a-z][a-z0-9_.-]{0,99}$/.test(value.relation))))) return false;
  if (typeof event.name !== 'string' || !/^[a-z][a-z0-9_.]{1,99}$/.test(event.name) || typeof event.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(event.occurredAt) || !Number.isFinite(Date.parse(event.occurredAt))) return false;
  if (event.properties !== undefined && (!event.properties || typeof event.properties !== 'object' || Array.isArray(event.properties))) return false;
  const json = (value: unknown, depth = 0): boolean => depth <= 40 && (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(item => json(item, depth + 1))
    || typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(item => json(item, depth + 1)));
  return Object.entries(event.properties ?? {}).length <= 40 && Object.entries(event.properties ?? {}).every(([name, value]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) && json(value));
}
/** Server only. Preserve operation IDs and use the application's durable outbox. */
export function createTrackingClient(options: TrackingOptions) {
  const transport = trackingTransport(options);
  return {
    replaySession: replaySessionRequest(options),
    track: async (event: TrackingEvent): Promise<TrackingReceipt> => {
      if (!validEvent(event)) return { accepted: false, retryable: false, code: 'invalid_event' };
      const properties = { ...event.properties }, content: Record<string, ContentReference> = {};
      const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
      for (const [name, value] of Object.entries(properties).sort((a, b) => size(b[1]) - size(a[1]))) {
        if (size(value) <= 2000 && size({ ...event, properties, content }) <= 28000) continue;
        const uploaded = await uploadRecordContent(options, value);
        if ('failure' in uploaded) return uploaded.failure;
        content[name] = uploaded.reference; delete properties[name];
      }
      return transport.post('events', { ...event, properties, content });
    },
    identify: (profile: TrackingProfile): Promise<TrackingReceipt> => transport.post('profiles', profile),
    coverage: (watermark: TrackingCoverage): Promise<TrackingReceipt> => transport.post('coverage', watermark),
    receipt: transport.receipt,
  };
}
