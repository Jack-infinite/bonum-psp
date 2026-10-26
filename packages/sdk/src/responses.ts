import { BonumUnexpectedResponseError } from './errors.js';
import { readFields } from './fields.js';
import {
  type Payment,
  type PaymentResult,
  PaymentStatus,
  type PaymentSubmission,
} from './types.js';

const STATUSES: readonly PaymentStatus[] = Object.values(PaymentStatus);
const REPORT =
  'If Bonum changed its API, please report it at https://github.com/Jack-infinite/bonum-psp/issues.';

function unexpected(what: string, advice: string, body: unknown): (problem: string) => Error {
  return (problem) =>
    new BonumUnexpectedResponseError(
      `Unexpected ${what} from Bonum: ${problem}. ${advice} ${REPORT}`,
      {
        body,
      },
    );
}

/** Checks the shape of a submission response. */
export function parseSubmission(data: unknown): PaymentSubmission {
  const read = readFields(
    data,
    unexpected(
      'submission response',
      'The payment may still have been created: look it up by orderId before asking the customer to pay again.',
      data,
    ),
  );
  return {
    paymentId: read.string('paymentId'),
    orderId: read.string('orderId'),
    status: read.oneOf('status', STATUSES),
    acceptedAt: read.string('acceptedAt'),
    statusUrl: read.string('statusUrl'),
    awaitUrl: read.string('awaitUrl'),
  };
}

/** Checks the shape of a payment returned by a lookup. */
export function parsePayment(data: unknown): Payment {
  const read = readFields(
    data,
    unexpected('payment', 'Do not fulfil the order based on this response.', data),
  );
  return {
    paymentId: read.string('paymentId'),
    orderId: read.string('orderId'),
    amount: read.decimalString('amount'),
    currency: read.decimalString('currency'),
    walletType: read.string('walletType'),
    status: read.oneOf('status', STATUSES),
    providerReference: read.nullableString('providerReference'),
    failureReason: read.nullableString('failureReason'),
    createdAt: read.string('createdAt'),
    updatedAt: read.string('updatedAt'),
  };
}

/** Checks the by-order-id lookup, which the V2 reference documents as a single payment. */
export function parsePaymentLookup(data: unknown): Payment {
  if (Array.isArray(data)) {
    throw new BonumUnexpectedResponseError(
      'Bonum returned a list of payments for this orderId, but the V2 API reference documents a single ' +
        'payment, so the SDK will not guess which one counts. Look the payment up by paymentId, and use ' +
        `a new order_id for every payment attempt. ${REPORT}`,
      { body: data },
    );
  }
  return parsePayment(data);
}

/** Checks the shape of an await result and normalizes `timedOut` to a boolean. */
export function parsePaymentResult(data: unknown): PaymentResult {
  const read = readFields(
    data,
    unexpected('wait result', 'Look the payment up with payments.get() instead.', data),
  );
  return {
    paymentId: read.string('paymentId'),
    status: read.oneOf('status', STATUSES),
    failureReason: read.nullableString('failureReason'),
    timedOut: read.flag('timedOut'),
  };
}
