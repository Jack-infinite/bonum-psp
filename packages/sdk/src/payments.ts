import type { HttpClient } from './http.js';
import type {
  RequestOptions,
  SubmitApplePayParams,
  SubmitGooglePayParams,
  WaitForResultOptions,
} from './params.js';
import {
  parsePayment,
  parsePaymentLookup,
  parsePaymentResult,
  parseSubmission,
} from './responses.js';
import type { Payment, PaymentResult, PaymentSubmission } from './types.js';
import {
  isRecord,
  validateAmount,
  validateBranchId,
  validateCurrency,
  validateOrderId,
  validateParams,
  validatePaymentId,
  validateRequestOptions,
  validateWaitOptions,
} from './validation.js';
import { parseApplePayToken, validateGooglePayToken } from './wallet-tokens.js';

const API = '/api/v2';
// The await endpoint holds the connection for up to `waitMs`; allow time for the answer to arrive.
const WAIT_GRACE_MS = 5_000;

/**
 * Submits wallet payments and looks them up. Use it as `bonum.payments`.
 *
 * Submissions are retried on network errors, timeouts, 429 and 5xx. That is safe because Bonum
 * treats `order_id` as an idempotency key: a repeated `order_id` returns the existing payment.
 *
 * @example
 * ```ts
 * const submission = await bonum.payments.submitApplePay({ orderId: 'ORD-1001', token });
 * const result = await bonum.payments.waitForResult(submission);
 * ```
 */
export class Payments {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Submits an Apple Pay payment. Resolves with status `PENDING` for a new payment — that is not a
   * failure; wait for the result or the webhook. The token is sent exactly as given.
   *
   * @example
   * ```ts
   * const submission = await bonum.payments.submitApplePay({
   *   orderId: 'ORD-1001',
   *   token: req.body.applePayToken, // the PKPaymentToken object, or its JSON string
   *   amount: 150.5,
   * });
   * ```
   */
  async submitApplePay(
    params: SubmitApplePayParams,
    options?: RequestOptions,
  ): Promise<PaymentSubmission> {
    const fields = validateParams(params);
    const body = {
      order_id: validateOrderId(fields.orderId),
      token: parseApplePayToken(fields.token),
      ...optionalFields(fields),
    };
    return this.#submit(`${API}/payment/process`, body, options);
  }

  /**
   * Submits a Google Pay payment. Resolves with status `PENDING` for a new payment — that is not a
   * failure; wait for the result or the webhook. The token is sent exactly as given.
   *
   * @example
   * ```ts
   * const submission = await bonum.payments.submitGooglePay({
   *   orderId: 'ORD-1002',
   *   token: paymentData.paymentMethodData.tokenizationData.token,
   *   currency: 'MNT',
   *   amount: 150.5,
   * });
   * ```
   */
  async submitGooglePay(
    params: SubmitGooglePayParams,
    options?: RequestOptions,
  ): Promise<PaymentSubmission> {
    const fields = validateParams(params);
    const body = {
      order_id: validateOrderId(fields.orderId),
      token: validateGooglePayToken(fields.token),
      currency_code: validateCurrency(fields.currency),
      ...optionalFields(fields),
    };
    return this.#submit(`${API}/payment/process/google`, body, options);
  }

  /**
   * Gets the current state of a payment by Bonum's `paymentId`.
   *
   * @example
   * ```ts
   * const payment = await bonum.payments.get('3f0c…-uuid');
   * if (payment.status === 'AUTHORIZED') await fulfilOrder(payment.orderId);
   * ```
   */
  async get(paymentId: string, options?: RequestOptions): Promise<Payment> {
    const id = encodeURIComponent(validatePaymentId(paymentId));
    const { signal, timeoutMs } = validateRequestOptions(options);
    return this.#http.request({
      method: 'GET',
      path: `${API}/payments/${id}`,
      parse: parsePayment,
      retry: true,
      timeoutMs,
      signal,
    });
  }

  /**
   * Gets the current state of a payment by your `order_id` — handy for reconciliation when you
   * never stored the `paymentId`.
   *
   * @example
   * ```ts
   * const payment = await bonum.payments.getByOrderId('ORD-1001');
   * ```
   */
  async getByOrderId(orderId: string, options?: RequestOptions): Promise<Payment> {
    const { signal, timeoutMs } = validateRequestOptions(options);
    return this.#http.request({
      method: 'GET',
      path: `${API}/payments/lookup/by-order-id`,
      query: { orderId: validateOrderId(orderId) },
      parse: parsePaymentLookup,
      retry: true,
      timeoutMs,
      signal,
    });
  }

  /**
   * Long-polls Bonum until the bank answers or `waitMs` (default 25 s, max 28 s) passes — use it
   * to close the wallet sheet with the real outcome. `PENDING` with `timedOut: true` means the bank
   * has not answered yet: rely on the webhook. Never retried, to fit the wallet sheet's time limit.
   *
   * @example
   * ```ts
   * const result = await bonum.payments.waitForResult(submission, { waitMs: 20_000 });
   * return result.status === 'AUTHORIZED' ? 'success' : result.status === 'FAILED' ? 'failure' : 'pending';
   * ```
   */
  async waitForResult(
    payment: string | Pick<PaymentSubmission, 'paymentId'>,
    options?: WaitForResultOptions,
  ): Promise<PaymentResult> {
    const paymentId =
      typeof payment === 'string' ? payment : isRecord(payment) ? payment.paymentId : undefined;
    const id = encodeURIComponent(validatePaymentId(paymentId));
    const { waitMs, signal } = validateWaitOptions(options);
    return this.#http.request({
      method: 'GET',
      path: `${API}/payments/${id}/await`,
      query: { timeoutMs: String(waitMs) },
      parse: parsePaymentResult,
      retry: false,
      timeoutMs: waitMs + WAIT_GRACE_MS,
      signal,
    });
  }

  #submit(
    path: string,
    body: Record<string, unknown>,
    options: unknown,
  ): Promise<PaymentSubmission> {
    const { signal, timeoutMs } = validateRequestOptions(options);
    return this.#http.request({
      method: 'POST',
      path,
      body,
      parse: parseSubmission,
      retry: true,
      timeoutMs,
      signal,
    });
  }
}

// Optional fields are left out entirely when not given; Bonum never receives `null` placeholders.
function optionalFields(fields: Record<string, unknown>): { amount?: number; branch_id?: string } {
  const amount = validateAmount(fields.amount);
  const branchId = validateBranchId(fields.branchId);
  return {
    ...(amount === undefined ? {} : { amount }),
    ...(branchId === undefined ? {} : { branch_id: branchId }),
  };
}
