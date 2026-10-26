/**
 * Currencies Bonum accepts for Google Pay (`currency_code`).
 *
 * @example
 * ```ts
 * await bonum.payments.submitGooglePay({ orderId, token, currency: CurrencyCode.MNT });
 * ```
 */
export const CurrencyCode = {
  MNT: 'MNT',
  USD: 'USD',
  EUR: 'EUR',
  JPY: 'JPY',
} as const;

/**
 * One of the {@link CurrencyCode} values.
 *
 * @example
 * ```ts
 * const currency: CurrencyCode = 'MNT';
 * ```
 */
export type CurrencyCode = (typeof CurrencyCode)[keyof typeof CurrencyCode];

const ALPHA_BY_NUMERIC: ReadonlyMap<string, CurrencyCode> = new Map<string, CurrencyCode>([
  ['496', 'MNT'],
  ['840', 'USD'],
  ['978', 'EUR'],
  ['392', 'JPY'],
]);

const CURRENCY_CODES: ReadonlySet<string> = new Set<string>(Object.values(CurrencyCode));

/**
 * Maps an ISO 4217 numeric code to its alpha code (`"496"` → `"MNT"`). Alpha codes and unknown
 * values are returned unchanged. Bonum's docs show both formats for `currency`, so compare
 * normalized values rather than raw API data.
 *
 * @example
 * ```ts
 * normalizeCurrency('496'); // 'MNT'
 * normalizeCurrency('MNT'); // 'MNT'
 * ```
 */
export function normalizeCurrency(code: string): string {
  return ALPHA_BY_NUMERIC.get(code.trim()) ?? code;
}

/** Narrows `value` to a currency Bonum accepts for Google Pay. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCY_CODES.has(value);
}
