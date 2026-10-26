import type { CurrencyCode } from './currency.js';

/**
 * Per-request options accepted by every API method.
 *
 * @example
 * ```ts
 * await bonum.payments.get(paymentId, { timeoutMs: 5_000, signal: AbortSignal.timeout(20_000) });
 * ```
 */
export interface RequestOptions {
  /** Cancels the request and any pending retry. The SDK rethrows the signal's reason. */
  signal?: AbortSignal | undefined;
  /** Timeout for each HTTP attempt in milliseconds. Defaults to the client's `timeoutMs`. */
  timeoutMs?: number | undefined;
}

/**
 * Options for `payments.waitForResult()`.
 *
 * @example
 * ```ts
 * await bonum.payments.waitForResult(submission, { waitMs: 20_000 });
 * ```
 */
export interface WaitForResultOptions {
  /** How long Bonum should hold the request open, 1–28 000 ms. Defaults to 25 000. */
  waitMs?: number | undefined;
  /** Cancels the wait. The SDK rethrows the signal's reason. */
  signal?: AbortSignal | undefined;
}

/**
 * Apple's `PKPaymentToken` as JSON — the shape Apple Pay hands to your app or web page. Pass it to
 * Bonum exactly as received; the SDK never changes it.
 *
 * @example
 * ```ts
 * // Apple Pay JS: session.onpaymentauthorized = (event) => send(event.payment.token)
 * const token: ApplePayPaymentToken = request.body.token;
 * ```
 */
export interface ApplePayPaymentToken {
  /** The encrypted payment data. */
  paymentData: ApplePayPaymentData;
  /** Display details of the card the customer chose. */
  paymentMethod: ApplePayPaymentMethod;
  /** Apple's id for the transaction. */
  transactionIdentifier: string;
}

/**
 * The encrypted part of an {@link ApplePayPaymentToken}.
 *
 * @example
 * ```ts
 * const version: ApplePayPaymentData['version'] = token.paymentData.version; // 'EC_v1'
 * ```
 */
export interface ApplePayPaymentData {
  data: string;
  signature: string;
  header: ApplePayPaymentDataHeader;
  version: string;
}

/**
 * The header of {@link ApplePayPaymentData}. `ephemeralPublicKey` is set for `EC_v1` tokens and
 * `wrappedKey` for `RSA_v1` tokens.
 *
 * @example
 * ```ts
 * const header: ApplePayPaymentDataHeader = token.paymentData.header;
 * ```
 */
export interface ApplePayPaymentDataHeader {
  publicKeyHash: string;
  transactionId: string;
  ephemeralPublicKey?: string | undefined;
  wrappedKey?: string | undefined;
  applicationData?: string | undefined;
}

/**
 * Card details Apple shares in the token, e.g. `{ displayName: 'Visa 1234', network: 'Visa',
 * type: 'debit' }`.
 *
 * @example
 * ```ts
 * const method: ApplePayPaymentMethod = token.paymentMethod;
 * ```
 */
export interface ApplePayPaymentMethod {
  displayName?: string | undefined;
  network?: string | undefined;
  type?: string | undefined;
}

/**
 * Parameters for `payments.submitApplePay()`.
 *
 * @example
 * ```ts
 * const params: SubmitApplePayParams = { orderId: 'ORD-1001', token: applePayToken, amount: 150.5 };
 * ```
 */
export interface SubmitApplePayParams {
  /** Your unique order id, 1–128 characters. Re-sending it returns the existing payment. */
  orderId: string;
  /** The `PKPaymentToken` object from Apple Pay, or its JSON string. Sent unchanged. */
  token: ApplePayPaymentToken | string;
  /** Amount in major units (150.5 = 150.50 MNT): at least 0.01, at most 2 decimal places. */
  amount?: number | undefined;
  /** Your branch id, 1–64 characters, if Bonum set up branches for you. */
  branchId?: string | undefined;
}

/**
 * Parameters for `payments.submitGooglePay()`.
 *
 * @example
 * ```ts
 * const params: SubmitGooglePayParams = { orderId: 'ORD-1002', token, currency: 'MNT', amount: 150.5 };
 * ```
 */
export interface SubmitGooglePayParams {
  /** Your unique order id, 1–128 characters. Re-sending it returns the existing payment. */
  orderId: string;
  /** `paymentData.paymentMethodData.tokenizationData.token` from Google Pay, unchanged. */
  token: string;
  /** The currency of the payment. */
  currency: CurrencyCode;
  /** Amount in major units (150.5 = 150.50 MNT): at least 0.01, at most 2 decimal places. */
  amount?: number | undefined;
  /** Your branch id, 1–64 characters, if Bonum set up branches for you. */
  branchId?: string | undefined;
}
