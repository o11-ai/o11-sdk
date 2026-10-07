import type { createTrackingClient, TrackingEvent } from './index';
import type { TrackingProfile } from './profile';

export type DeliveryState = {
  phase: 'profile' | 'event'; status: 'pending' | 'processed' | 'rejected';
  receiptId: string | null; receiptStartedAt?: Date | null; lastCode: string | null; nextAttemptAt: Date; processedAt: Date | null;
};
export type DeliveryItem = DeliveryState & { event: TrackingEvent; profile: TrackingProfile; attempts: number; createdAt: Date };

/** One persisted step. Store the returned state in the application's existing outbox. */
export async function advanceTrackingDelivery(row: DeliveryItem, client: ReturnType<typeof createTrackingClient>, now: Date): Promise<DeliveryState> {
  const patch: DeliveryState = { phase: row.phase, status: 'pending', receiptId: row.receiptId, lastCode: null,
    receiptStartedAt: row.receiptStartedAt ?? null, nextAttemptAt: new Date(now.getTime() + 5000), processedAt: null };
  if (row.receiptId) {
    const receipt = await client.receipt(row.receiptId);
    if (!receipt || receipt.status === 'queued') {
      const expired = now.getTime() - (row.receiptStartedAt ?? row.createdAt).getTime() >= 86400000;
      return { ...patch, status: expired ? 'rejected' : 'pending', lastCode: expired ? 'receipt_review_required' : !receipt ? 'receipt_unavailable' : null };
    }
    if (receipt.kind !== row.phase) return { ...patch, status: 'rejected', lastCode: 'receipt_kind_mismatch' };
    if (receipt.status === 'rejected') return { ...patch, status: 'rejected', lastCode: receipt.code ?? 'receipt_rejected' };
    if (row.phase === 'profile') return { ...patch, phase: 'event', receiptId: null, receiptStartedAt: null, nextAttemptAt: now };
    return { ...patch, status: 'processed', processedAt: now };
  }
  const delivery = row.phase === 'profile' ? await client.identify(row.profile) : await client.track(row.event);
  if (delivery.accepted && delivery.receiptId) return { ...patch, receiptId: delivery.receiptId, receiptStartedAt: now };
  return { ...patch, status: delivery.retryable ? 'pending' : 'rejected', lastCode: delivery.code ?? 'delivery_unconfirmed',
    nextAttemptAt: new Date(now.getTime() + Math.max(delivery.retryAfterMs ?? 0, Math.min(3600000, 1000 * 2 ** Math.min(row.attempts, 12)))) };
}
