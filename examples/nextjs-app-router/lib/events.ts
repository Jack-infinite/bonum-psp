import type { BonumWebhookEvent } from 'bonum-psp';

// Stand-in for your database. Two levels of idempotency, because a retry may carry a new
// webhookId: dedupe on webhookId (unique index), then move each payment out of PENDING only once
// (UPDATE ... WHERE payment_id = $1 AND status = 'PENDING').
const seenWebhookIds = new Set<string>();
const paymentStatus = new Map<string, BonumWebhookEvent['status']>();

/** Records a verified event. Keep this fast; do slow work (emails, fulfilment) in a queue. */
export async function saveEvent(event: BonumWebhookEvent): Promise<void> {
  if (seenWebhookIds.has(event.webhookId)) return;
  seenWebhookIds.add(event.webhookId);
  if (!paymentStatus.has(event.paymentId)) paymentStatus.set(event.paymentId, event.status);
}
