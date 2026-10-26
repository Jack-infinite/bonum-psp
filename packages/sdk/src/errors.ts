/**
 * Stable, machine-readable codes carried by every {@link BonumError}.
 *
 * @example
 * ```ts
 * if (isBonumError(error) && error.code === 'timeout') await retryLater();
 * ```
 */
export type BonumErrorCode =
  | 'invalid_config'
  | 'invalid_request'
  | 'connection_error'
  | 'timeout'
  | 'unexpected_response'
  | 'api_error'
  | 'webhook_error';

/**
 * Why a webhook was rejected. Safe to return to the caller: none of them reveal the secret.
 *
 * @example
 * ```ts
 * if (error instanceof BonumWebhookError && error.reason === 'body_not_raw') fixBodyParser();
 * ```
 */
export type BonumWebhookErrorReason =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'invalid_signature_format'
  | 'signature_mismatch'
  | 'body_not_raw'
  | 'invalid_payload'
  | 'unsupported_event_type';

/**
 * Options shared by the SDK's error constructors.
 *
 * @example
 * ```ts
 * new BonumConnectionError('Bonum is unreachable', { cause: networkError });
 * ```
 */
export interface BonumErrorOptions {
  /** The underlying error, if any. */
  cause?: unknown;
}

/**
 * Base class of every error this SDK throws. Switch on `code` rather than on messages.
 *
 * @example
 * ```ts
 * try {
 *   await bonum.payments.get(paymentId);
 * } catch (error) {
 *   if (error instanceof BonumError) console.error(error.code, error.message);
 * }
 * ```
 */
export abstract class BonumError extends Error {
  /** Stable, machine-readable error code. */
  abstract readonly code: BonumErrorCode;
  override readonly name: string = 'BonumError';

  constructor(message: string, options?: BonumErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
  }
}

/**
 * The client or webhook verifier is misconfigured, e.g. a missing key or environment.
 *
 * @example
 * ```ts
 * new BonumClient({ environment: 'sandbox' }); // throws when BONUM_MERCHANT_KEY is not set
 * ```
 */
export class BonumConfigError extends BonumError {
  readonly code = 'invalid_config';
  override readonly name: string = 'BonumConfigError';
}

/**
 * A parameter failed client-side validation; nothing was sent to Bonum.
 *
 * @example
 * ```ts
 * if (error instanceof BonumValidationError) return badRequest(`${error.field}: ${error.message}`);
 * ```
 */
export class BonumValidationError extends BonumError {
  readonly code = 'invalid_request';
  override readonly name: string = 'BonumValidationError';
  /** The parameter that failed, e.g. `"amount"`. */
  readonly field: string;

  constructor(message: string, field: string, options?: BonumErrorOptions) {
    super(message, options);
    this.field = field;
  }
}

/**
 * Bonum could not be reached (DNS, TLS, connection reset, …). Already retried.
 *
 * @example
 * ```ts
 * if (error instanceof BonumConnectionError) console.error('Bonum unreachable', error.cause);
 * ```
 */
export class BonumConnectionError extends BonumError {
  readonly code = 'connection_error';
  override readonly name: string = 'BonumConnectionError';
}

/**
 * Bonum did not answer within `timeoutMs`. Already retried. A submission may still have gone
 * through — look it up by order id before asking the customer to pay again.
 *
 * @example
 * ```ts
 * if (error instanceof BonumTimeoutError) payment = await bonum.payments.getByOrderId(orderId);
 * ```
 */
export class BonumTimeoutError extends BonumError {
  readonly code = 'timeout';
  override readonly name: string = 'BonumTimeoutError';
}

/**
 * Bonum answered with something this SDK does not understand: a redirect, a non-JSON body or an
 * unexpected shape. `body` holds the parsed response when there was one.
 *
 * @example
 * ```ts
 * if (error instanceof BonumUnexpectedResponseError) console.error(error.message, error.body);
 * ```
 */
export class BonumUnexpectedResponseError extends BonumError {
  readonly code = 'unexpected_response';
  override readonly name: string = 'BonumUnexpectedResponseError';
  /** The parsed response body, if any. */
  readonly body: unknown;

  constructor(message: string, options?: BonumErrorOptions & { body?: unknown }) {
    super(message, options);
    this.body = options?.body;
  }
}

/**
 * A webhook failed verification or carried a payload this SDK cannot handle. `reason` says which
 * check failed; the message says how to fix it.
 *
 * @example
 * ```ts
 * if (error instanceof BonumWebhookError) return new Response(null, { status: 400 });
 * ```
 */
export class BonumWebhookError extends BonumError {
  readonly code = 'webhook_error';
  override readonly name: string = 'BonumWebhookError';
  /** Which check failed. */
  readonly reason: BonumWebhookErrorReason;

  constructor(reason: BonumWebhookErrorReason, message: string, options?: BonumErrorOptions) {
    super(message, options);
    this.reason = reason;
  }
}

/**
 * Returns `true` for any error thrown by this SDK.
 *
 * @example
 * ```ts
 * if (isBonumError(error)) console.error(`[bonum:${error.code}] ${error.message}`);
 * ```
 */
export function isBonumError(value: unknown): value is BonumError {
  return value instanceof BonumError;
}
