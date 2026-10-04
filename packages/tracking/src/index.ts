import { trackingTransport, type TrackingOptions, type TrackingReceipt } from './transport';
import type { TrackingProfile, TrackingCoverage } from './profile';
export type { TrackingOptions, TrackingReceipt, TrackingFetch, ReceiptStatus } from './transport';
export type { TrackingProfile, TrackingCoverage, ContactChannel } from './profile';
export type TrackingEvent = {
  eventId: string; name: string; customerId: string; occurredAt: string;
  sessionId?: string; properties?: Record<string, string | number | boolean>;
};
export function validEvent(input: unknown): input is TrackingEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const event = input as Record<string, unknown>;
  const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 128;
  if (!id(event.eventId) || !id(event.customerId) || (event.sessionId !== undefined && !id(event.sessionId))) return false;
  if (typeof event.name !== 'string' || !/^[a-z][a-z0-9_.]{1,99}$/.test(event.name) || typeof event.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(event.occurredAt) || !Number.isFinite(Date.parse(event.occurredAt))) return false;
  if (event.properties !== undefined && (!event.properties || typeof event.properties !== 'object' || Array.isArray(event.properties))) return false;
  return Object.entries(event.properties ?? {}).length <= 20 && Object.entries(event.properties ?? {}).every(([name, value]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)
    && (typeof value === 'string' ? value.length <= 2000 : typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))));
}
/** Server only. Preserve operation IDs and use the application's durable outbox. */
export function createTrackingClient(options: TrackingOptions) {
  const transport = trackingTransport(options);
  return {
    track: (event: TrackingEvent): Promise<TrackingReceipt> => validEvent(event) ? transport.post('events', event) : Promise.resolve({ accepted: false, retryable: false, code: 'invalid_event' }),
    identify: (profile: TrackingProfile): Promise<TrackingReceipt> => transport.post('profiles', profile),
    coverage: (watermark: TrackingCoverage): Promise<TrackingReceipt> => transport.post('coverage', watermark),
    receipt: transport.receipt,
  };
}
