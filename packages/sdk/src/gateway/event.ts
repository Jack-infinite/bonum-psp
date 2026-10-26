import { BonumWebhookError } from '../errors.js';
import { readFields } from '../fields.js';
import { isRecord } from '../validation.js';

/**
 * Outcome of an invoice payment webhook. Only `SUCCESS` means the customer paid.
 *
 * @example
 * ```ts
 * if (event.status === InvoicePaymentStatus.SUCCESS) await markPaid(event.transactionId);
 * ```
 */
export const InvoicePaymentStatus = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

/**
 * One of the {@link InvoicePaymentStatus} values.
 *
 * @example
 * ```ts
 * const status: InvoicePaymentStatus = 'FAILED';
 * ```
 */
export type InvoicePaymentStatus = (typeof InvoicePaymentStatus)[keyof typeof InvoicePaymentStatus];

/**
 * A verified invoice webhook: the customer paid (`SUCCESS`), or the invoice failed or expired
 * (`FAILED`). Match it to your order by `transactionId`, and check `amount` before fulfilling.
 *
 * @example
 * ```ts
 * const event: InvoicePaymentEvent = await gateway.webhooks.verify(rawBody, req.headers);
 * if (event.status === 'SUCCESS') await markPaid(event.transactionId, event.amount);
 * ```
 */
export interface InvoicePaymentEvent {
  type: 'PAYMENT';
  status: InvoicePaymentStatus;
  /** Your `transactionId` from `invoices.create()`. */
  transactionId: string;
  /** Bonum's invoice id. It may differ from the `invoiceId` that create returned. */
  invoiceId: string | null;
  /** Decimal string in major units, e.g. `"5000"`. */
  amount: string | null;
  /** Usually `"MNT"`. */
  currency: string | null;
  /** How the customer paid, e.g. `"QPAY"`; set for `SUCCESS`. */
  paymentVendor: string | null;
  /** Bonum's invoice state, e.g. `"PAID"` or `"EXPIRED"`. */
  invoiceStatus: string | null;
  /** When the payment completed, as Bonum formats it; set for `SUCCESS`. */
  completedAt: string | null;
  /** The terminal the invoice belongs to. */
  terminalId: string | null;
  /** The whole `body` object, for fields this type does not model (e.g. `extras`). */
  body: Readonly<Record<string, unknown>>;
}

const STATUSES: readonly InvoicePaymentStatus[] = Object.values(InvoicePaymentStatus);

/** Turns a verified, parsed gateway webhook into a typed event. */
export function parseInvoicePaymentEvent(data: unknown): InvoicePaymentEvent {
  readType(data);
  const fail = (problem: string): Error =>
    new BonumWebhookError('invalid_payload', `Invalid webhook payload: ${problem}.`);
  const top = readFields(data, fail);
  const status = top.oneOf('status', STATUSES);
  const body = isRecord(data) ? data.body : undefined;
  if (!isRecord(body)) throw fail('"body" should be an object');
  const read = readFields(body, (problem) => fail(`in "body", ${problem}`));
  const transactionId = read.string('transactionId');
  if (transactionId === '') throw fail('"body.transactionId" is empty');
  return {
    type: 'PAYMENT',
    status,
    transactionId,
    invoiceId: read.nullableString('invoiceId'),
    amount: read.nullableDecimalString('amount'),
    currency: read.nullableString('currency'),
    paymentVendor: read.nullableString('paymentVendor'),
    // A successful payment reports it as `status`, an expired invoice as `invoiceStatus`.
    invoiceStatus: read.nullableString('status') ?? read.nullableString('invoiceStatus'),
    completedAt: read.nullableString('completedAt'),
    terminalId: read.nullableDecimalString('terminalId'),
    body,
  };
}

// Checked first: other types (e.g. CARD-TOKEN) have another shape, and must be acknowledged
// rather than rejected, or Bonum keeps retrying them (see docs/decisions.md).
function readType(data: unknown): void {
  const value = isRecord(data) ? data.type : undefined;
  if (typeof value !== 'string') {
    throw new BonumWebhookError('invalid_payload', 'Invalid webhook payload: "type" is missing.');
  }
  if (value === 'PAYMENT') return;
  throw new BonumWebhookError(
    'unsupported_event_type',
    `Unsupported webhook type ${JSON.stringify(value.slice(0, 40))}. The checksum is valid, but ` +
      'bonum-psp only handles invoice PAYMENT webhooks.',
  );
}
