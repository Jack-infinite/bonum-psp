import type { BonumWebhookEvent } from 'bonum-psp';

// An in-memory stand-in for your database, to show the idempotency rules. In production:
// - a unique index on webhookId (level 1: the same delivery twice), and
// - a conditional update per payment (level 2: a retry that carries a new webhookId), e.g.
//   UPDATE orders SET status = $1 WHERE payment_id = $2 AND status = 'PENDING'
//   or in MongoDB: orders.updateOne({ paymentId, status: 'PENDING' }, { $set: { status } })

export interface Order {
  orderId: string;
  /** Major units. Your backend decides the amount — never trust one sent by the app. */
  amount: number;
  status: 'PENDING' | 'AUTHORIZED' | 'FAILED';
  paymentId?: string;
}

const orders = new Map<string, Order>([
  ['ORD-1001', { orderId: 'ORD-1001', amount: 150.5, status: 'PENDING' }],
]);
const seenWebhookIds = new Set<string>();

export function findOrder(orderId: string): Order | undefined {
  return orders.get(orderId);
}

export function attachPayment(orderId: string, paymentId: string): void {
  const order = orders.get(orderId);
  if (order !== undefined) order.paymentId = paymentId;
}

/** Applies a verified webhook at most once. Returns what happened, for logging. */
export function applyWebhook(
  event: BonumWebhookEvent,
): 'duplicate' | 'unknown-order' | 'applied' | 'already-final' {
  if (seenWebhookIds.has(event.webhookId)) return 'duplicate';
  seenWebhookIds.add(event.webhookId);
  const order = orders.get(event.orderId);
  // Still answered with 200: a retry would not make the order appear (test events land here too).
  if (order === undefined) return 'unknown-order';
  if (order.status !== 'PENDING') return 'already-final';
  order.status = event.status;
  order.paymentId = event.paymentId;
  return 'applied';
}
