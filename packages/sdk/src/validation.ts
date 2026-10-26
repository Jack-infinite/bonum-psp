import { type CurrencyCode, isCurrencyCode } from './currency.js';
import { BonumValidationError } from './errors.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Checked on the number's own decimal representation, so float arithmetic cannot hide a third digit.
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const DEFAULT_WAIT_MS = 25_000;
const MAX_WAIT_MS = 28_000;

/** Narrows to a plain JSON object (not `null`, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates a Bonum payment id before it goes into a URL path. */
export function validatePaymentId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BonumValidationError(
      'paymentId must be a UUID, such as the paymentId returned when you submitted the payment.',
      'paymentId',
    );
  }
  return value;
}

/** Validates a merchant order id (1–128 characters). */
export function validateOrderId(value: unknown): string {
  return validateLength(value, 'orderId', 128);
}

/** Validates an optional branch id (1–64 characters). */
export function validateBranchId(value: unknown): string | undefined {
  return value === undefined ? undefined : validateLength(value, 'branchId', 64);
}

/** Validates an optional amount in major units: finite, at least 0.01, at most 2 decimals. */
export function validateAmount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0.01 ||
    !AMOUNT_PATTERN.test(String(value))
  ) {
    throw new BonumValidationError(
      `amount must be a number in major units, at least 0.01 with at most 2 decimal places (e.g. 150.5 for 150.50 MNT); got ${String(value)}.`,
      'amount',
    );
  }
  return value;
}

/** Validates a Google Pay currency code. */
export function validateCurrency(value: unknown): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new BonumValidationError('currency must be one of MNT, USD, EUR or JPY.', 'currency');
  }
  return value;
}

/** Validates `waitForResult()` options; `waitMs` defaults to 25 000 and may be at most 28 000. */
export function validateWaitOptions(options: unknown): {
  waitMs: number;
  signal: AbortSignal | undefined;
} {
  const { waitMs = DEFAULT_WAIT_MS, signal } = validateOptionsObject(options);
  if (
    typeof waitMs !== 'number' ||
    !Number.isInteger(waitMs) ||
    waitMs < 1 ||
    waitMs > MAX_WAIT_MS
  ) {
    throw new BonumValidationError(
      `waitMs must be an integer from 1 to ${MAX_WAIT_MS} (Bonum's maximum wait); got ${String(waitMs)}.`,
      'waitMs',
    );
  }
  return { waitMs, signal: validateSignal(signal) };
}

/** Validates the per-request options shared by every API method. */
export function validateRequestOptions(options: unknown): {
  signal: AbortSignal | undefined;
  timeoutMs: number | undefined;
} {
  const { signal, timeoutMs } = validateOptionsObject(options);
  if (timeoutMs !== undefined && !isPositiveInteger(timeoutMs)) {
    throw new BonumValidationError(
      `options.timeoutMs must be a positive integer number of milliseconds; got ${String(timeoutMs)}.`,
      'timeoutMs',
    );
  }
  return { signal: validateSignal(signal), timeoutMs };
}

/** Validates that a method's first argument is a parameters object. */
export function validateParams(params: unknown): Record<string, unknown> {
  if (!isRecord(params)) {
    throw new BonumValidationError(
      'params must be an object such as { orderId, token }.',
      'params',
    );
  }
  return params;
}

/** `true` for whole numbers ≥ 1 that `AbortSignal.timeout()` accepts. */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function validateLength(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    const got = typeof value === 'string' ? `${value.length} characters` : typeof value;
    throw new BonumValidationError(
      `${field} must be a string of 1–${max} characters; got ${got}.`,
      field,
    );
  }
  return value;
}

function validateOptionsObject(options: unknown): Record<string, unknown> {
  if (options === undefined) return {};
  if (!isRecord(options)) throw new BonumValidationError('options must be an object.', 'options');
  return options;
}

function validateSignal(signal: unknown): AbortSignal | undefined {
  if (signal === undefined || signal instanceof AbortSignal) return signal;
  throw new BonumValidationError('options.signal must be an AbortSignal.', 'signal');
}
