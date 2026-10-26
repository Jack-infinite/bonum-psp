import { BonumValidationError } from './errors.js';
import { isRecord } from './validation.js';

const APPLE_PAY_SHAPE =
  "Pass Apple's PKPaymentToken exactly as Apple Pay returned it: " +
  '{ paymentData: object, paymentMethod: object, transactionIdentifier: string }, or its JSON string.';

/**
 * Accepts the Apple Pay token as an object or as a JSON string (mobile bridges often send a string)
 * and checks its top-level shape. The returned object is the caller's token, untouched.
 */
export function parseApplePayToken(token: unknown): Record<string, unknown> {
  const value = typeof token === 'string' ? parseJsonToken(token) : token;
  if (
    isRecord(value) &&
    isRecord(value.paymentData) &&
    isRecord(value.paymentMethod) &&
    typeof value.transactionIdentifier === 'string'
  ) {
    return value;
  }
  throw new BonumValidationError(`${applePayHint(value)}${APPLE_PAY_SHAPE}`, 'token');
}

/** Checks the Google Pay token: the opaque `tokenizationData.token` string, passed through as is. */
export function validateGooglePayToken(token: unknown): string {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new BonumValidationError(
      'token must be the string at paymentData.paymentMethodData.tokenizationData.token from Google Pay, ' +
        'sent unchanged (do not JSON.parse it).',
      'token',
    );
  }
  if (isRecord(tryParseJson(token)?.paymentMethodData)) {
    throw new BonumValidationError(
      'token looks like the whole Google Pay PaymentData object. Pass ' +
        'paymentData.paymentMethodData.tokenizationData.token instead.',
      'token',
    );
  }
  return token;
}

function parseJsonToken(token: string): unknown {
  const value = tryParseJson(token);
  if (value === undefined) {
    throw new BonumValidationError(
      `token is a string but not a JSON object. ${APPLE_PAY_SHAPE}`,
      'token',
    );
  }
  return value;
}

// Name the two mistakes we expect most: sending only `paymentData`, or the whole ApplePayPayment.
function applePayHint(value: unknown): string {
  if (!isRecord(value)) return 'token must be an object. ';
  if (typeof value.data === 'string' && typeof value.signature === 'string') {
    return 'token looks like token.paymentData only. ';
  }
  if (isRecord(value.token))
    return 'token looks like the ApplePayPayment object; pass its `token` property. ';
  return 'token is missing paymentData, paymentMethod or transactionIdentifier. ';
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
