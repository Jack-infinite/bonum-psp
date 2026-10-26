import { BonumWebhookError } from '../errors.js';
import { readFields } from '../fields.js';
import type { WalletType } from '../types.js';
import { isRecord } from '../validation.js';

type OpenString = string & Record<never, never>;

/**
 * Webhook event types. Bonum sends a webhook once the bank has answered.
 *
 * @example
 * ```ts
 * if (event.eventType === WebhookEventType.AUTHORIZED) await fulfilOrder(event.orderId);
 * ```
 */
export const WebhookEventType = {
  AUTHORIZED: 'AUTHORIZED',
  FAILED: 'FAILED',
} as const;

/**
 * One of the {@link WebhookEventType} values.
 *
 * @example
 * ```ts
 * const type: WebhookEventType = 'FAILED';
 * ```
 */
export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];

/**
 * Card classification from the issuer BIN. An open union, so new categories don't break you.
 *
 * @example
 * ```ts
 * if (event.binCategory === BinCategory.INTERNATIONAL) flagForReview(event.paymentId);
 * ```
 */
export const BinCategory = {
  DOMESTIC: 'DOMESTIC',
  INTERNATIONAL: 'INTERNATIONAL',
} as const;

/**
 * One of the {@link BinCategory} values, or a category this SDK does not know yet.
 *
 * @example
 * ```ts
 * const category: BinCategory = 'DOMESTIC';
 * ```
 */
export type BinCategory = (typeof BinCategory)[keyof typeof BinCategory] | OpenString;

/**
 * Fields shared by every webhook event.
 *
 * @example
 * ```ts
 * const event: WebhookEventBase = await bonum.webhooks.verify(rawBody, req.headers);
 * ```
 */
export interface WebhookEventBase {
  /** Unique per delivery. Dedupe on it, and also make fulfilment idempotent per `paymentId`. */
  webhookId: string;
  /** Bonum's payment id, the same one the submission returned. */
  paymentId: string;
  /** Your `order_id`. */
  orderId: string;
  /** Decimal string in major units, e.g. `"150.50"`. */
  amount: string;
  /** Currency as sent, usually the alpha code (`"MNT"`). See `normalizeCurrency`. */
  currency: string;
  /** Bank/acquirer reference; normally set for `AUTHORIZED`. */
  providerReference: string | null;
  /** Why the payment failed; normally set for `FAILED`. */
  failureReason: string | null;
  /** When the bank event happened (ISO 8601). */
  occurredAt: string;
  /** Which wallet paid, when Bonum knows. */
  walletType: WalletType | null;
  /** Domestic or international card, when Bonum knows. */
  binCategory: BinCategory | null;
}

/**
 * The bank approved the payment: safe to fulfil the order (once — see `webhookId`).
 *
 * @example
 * ```ts
 * if (event.eventType === 'AUTHORIZED') await markPaid(event.paymentId, event.providerReference);
 * ```
 */
export interface PaymentAuthorizedEvent extends WebhookEventBase {
  eventType: 'AUTHORIZED';
  status: 'AUTHORIZED';
}

/**
 * The payment was declined or failed; `failureReason` says why.
 *
 * @example
 * ```ts
 * if (event.eventType === 'FAILED') await markFailed(event.paymentId, event.failureReason);
 * ```
 */
export interface PaymentFailedEvent extends WebhookEventBase {
  eventType: 'FAILED';
  status: 'FAILED';
}

/**
 * A verified Bonum webhook. Narrow on `eventType`.
 *
 * @example
 * ```ts
 * switch (event.eventType) {
 *   case 'AUTHORIZED': return markPaid(event);
 *   case 'FAILED': return markFailed(event);
 * }
 * ```
 */
export type BonumWebhookEvent = PaymentAuthorizedEvent | PaymentFailedEvent;

const EVENT_TYPES: readonly WebhookEventType[] = Object.values(WebhookEventType);

/** Turns a verified, parsed payload into a typed event. */
export function parseWebhookEvent(data: unknown): BonumWebhookEvent {
  const eventType = readEventType(data);
  const read = readFields(
    data,
    (problem) => new BonumWebhookError('invalid_payload', `Invalid webhook payload: ${problem}.`),
  );
  const common = {
    webhookId: read.string('webhookId'),
    paymentId: read.string('paymentId'),
    orderId: read.string('orderId'),
    amount: read.decimalString('amount'),
    currency: read.decimalString('currency'),
    providerReference: read.nullableString('providerReference'),
    failureReason: read.nullableString('failureReason'),
    occurredAt: read.string('occurredAt'),
    walletType: read.nullableString('walletType'),
    binCategory: read.nullableString('binCategory'),
  };
  if (read.string('status') !== eventType) {
    throw new BonumWebhookError(
      'invalid_payload',
      `Invalid webhook payload: "status" must equal eventType "${eventType}".`,
    );
  }
  // One branch per type, so TypeScript can pair each eventType with its status.
  return eventType === 'AUTHORIZED'
    ? { ...common, eventType, status: eventType }
    : { ...common, eventType, status: eventType };
}

// Checked before the other fields: an event type we don't know may well have a different shape,
// and it must be acknowledged rather than rejected (see docs/decisions.md).
function readEventType(data: unknown): WebhookEventType {
  const value = isRecord(data) ? data.eventType : undefined;
  if (typeof value !== 'string') {
    throw new BonumWebhookError(
      'invalid_payload',
      'Invalid webhook payload: "eventType" is missing.',
    );
  }
  const known = EVENT_TYPES.find((type) => type === value);
  if (known !== undefined) return known;
  throw new BonumWebhookError(
    'unsupported_event_type',
    `Unsupported webhook eventType ${JSON.stringify(value.slice(0, 40))}. The signature is valid, but ` +
      'this version of bonum-psp does not know the event; upgrade it to handle the event.',
  );
}
