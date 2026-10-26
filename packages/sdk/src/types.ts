// Keeps autocomplete for the known values while still accepting ones Bonum may add later.
type OpenString = string & Record<never, never>;

/**
 * The Bonum environment a client talks to. Sandbox is `testpsp.bonum.mn`, production is
 * `psp.bonum.mn`.
 *
 * @example
 * ```ts
 * const environment: BonumEnvironment = 'sandbox';
 * ```
 */
export type BonumEnvironment = 'sandbox' | 'production';

/**
 * Payment states. Only `AUTHORIZED` means the bank approved the payment and you may fulfil.
 *
 * @example
 * ```ts
 * if (payment.status === PaymentStatus.AUTHORIZED) await fulfilOrder(payment.orderId);
 * ```
 */
export const PaymentStatus = {
  /** Queued; the bank has not answered yet. Never fulfil a pending payment. */
  PENDING: 'PENDING',
  /** Approved by the bank and the funds are reserved. Safe to fulfil. */
  AUTHORIZED: 'AUTHORIZED',
  /** Declined or failed to process; `failureReason` says why. */
  FAILED: 'FAILED',
} as const;

/**
 * One of the {@link PaymentStatus} values.
 *
 * @example
 * ```ts
 * const status: PaymentStatus = 'PENDING';
 * ```
 */
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/**
 * A status that will not change any more: `AUTHORIZED` or `FAILED`.
 *
 * @example
 * ```ts
 * const done: TerminalPaymentStatus = 'AUTHORIZED';
 * ```
 */
export type TerminalPaymentStatus = Exclude<PaymentStatus, 'PENDING'>;

/**
 * Wallets Bonum processes. Typed as an open union so a wallet Bonum adds later does not break
 * your build or your webhook handler.
 *
 * @example
 * ```ts
 * if (payment.walletType === WalletType.APPLE_PAY) console.error('Paid with Apple Pay');
 * ```
 */
export const WalletType = {
  APPLE_PAY: 'APPLE_PAY',
  GOOGLE_PAY: 'GOOGLE_PAY',
} as const;

/**
 * One of the {@link WalletType} values, or a wallet this SDK does not know yet.
 *
 * @example
 * ```ts
 * const wallet: WalletType = 'GOOGLE_PAY';
 * ```
 */
export type WalletType = (typeof WalletType)[keyof typeof WalletType] | OpenString;

/**
 * Returns `true` when the status is final (`AUTHORIZED` or `FAILED`).
 *
 * @example
 * ```ts
 * if (!isTerminalStatus(payment.status)) scheduleRecheck(payment.paymentId);
 * ```
 */
export function isTerminalStatus(status: string): status is TerminalPaymentStatus {
  return status === PaymentStatus.AUTHORIZED || status === PaymentStatus.FAILED;
}

/**
 * Bonum's answer to a payment submission.
 *
 * @example
 * ```ts
 * const submission: PaymentSubmission = await bonum.payments.submitGooglePay(params);
 * await db.payments.insert({ orderId: submission.orderId, paymentId: submission.paymentId });
 * ```
 */
export interface PaymentSubmission {
  /** Bonum's id for the payment (UUID). Store it next to your order. */
  paymentId: string;
  /** Your `order_id`, echoed back. */
  orderId: string;
  /**
   * `PENDING` for a new payment — that is not a failure. Re-submitting an `order_id` returns the
   * existing payment, which may already be `AUTHORIZED` or `FAILED`.
   */
  status: PaymentStatus;
  /** When Bonum accepted the submission (ISO 8601). */
  acceptedAt: string;
  /** Bonum's status URL for this payment. Informational: the SDK never calls it. */
  statusUrl: string;
  /** Bonum's await URL for this payment. Informational: the SDK never calls it. */
  awaitUrl: string;
}

/**
 * The current state of a payment, as returned by the lookup endpoints.
 *
 * @example
 * ```ts
 * const payment: Payment = await bonum.payments.get(paymentId);
 * console.error(payment.status, payment.amount, normalizeCurrency(payment.currency));
 * ```
 */
export interface Payment {
  /** Bonum's id for the payment (UUID). */
  paymentId: string;
  /** Your `order_id`. */
  orderId: string;
  /** Decimal string in major units, e.g. `"150.50"`. Kept as a string to avoid float errors. */
  amount: string;
  /** Currency exactly as Bonum sent it: alpha (`"MNT"`) or numeric (`"496"`). See `normalizeCurrency`. */
  currency: string;
  /** Which wallet paid. */
  walletType: WalletType;
  /** Current status. Only `AUTHORIZED` is safe to fulfil. */
  status: PaymentStatus;
  /** Bank/acquirer reference, set once `AUTHORIZED`. */
  providerReference: string | null;
  /** Why the payment failed, set once `FAILED`. */
  failureReason: string | null;
  /** ISO 8601 creation time. */
  createdAt: string;
  /** ISO 8601 time of the last change. */
  updatedAt: string;
}

/**
 * The outcome of `payments.waitForResult()`.
 *
 * @example
 * ```ts
 * const result: PaymentResult = await bonum.payments.waitForResult(submission);
 * if (result.timedOut) console.error('Still pending — the webhook will tell us');
 * ```
 */
export interface PaymentResult {
  /** Bonum's id for the payment (UUID). */
  paymentId: string;
  /** `PENDING` only when the wait ended before the bank answered. */
  status: PaymentStatus;
  /** Why the payment failed, when `status` is `FAILED`. */
  failureReason: string | null;
  /** `true` when Bonum stopped waiting before the bank answered. */
  timedOut: boolean;
}
