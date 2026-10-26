import { BonumConfigError } from '../errors.js';
import type { InvoicePaymentStatus } from './event.js';

const encoder = new TextEncoder();

/**
 * Overrides for {@link createTestInvoiceWebhook}.
 *
 * @example
 * ```ts
 * const overrides: TestInvoiceWebhookOverrides = { status: 'FAILED', transactionId: 'ORD-1001' };
 * ```
 */
export interface TestInvoiceWebhookOverrides {
  status?: InvoicePaymentStatus | undefined;
  transactionId?: string | undefined;
  amount?: number | undefined;
  invoiceId?: string | undefined;
}

/**
 * Builds an invoice webhook payload shaped like Bonum's: `SUCCESS` (paid with QPay) by default,
 * or `FAILED` for an expired invoice. Use it in your own tests.
 *
 * @example
 * ```ts
 * import { createTestInvoiceWebhook } from 'bonum-psp/testing';
 *
 * const payload = createTestInvoiceWebhook({ transactionId: 'ORD-1001', amount: 5000 });
 * ```
 */
export function createTestInvoiceWebhook(
  overrides: TestInvoiceWebhookOverrides = {},
): Record<string, unknown> {
  const {
    status = 'SUCCESS',
    transactionId = `ORD-TEST-${crypto.randomUUID().slice(0, 8)}`,
    amount = 5000,
    invoiceId = crypto.randomUUID().replaceAll('-', ''),
  } = overrides;
  const common = { transactionId, amount, currency: 'MNT', terminalId: '00000000' };
  const body =
    status === 'SUCCESS'
      ? {
          ...common,
          invoiceId,
          completedAt: '2026-10-26 12:00:00',
          paymentVendor: 'QPAY',
          initType: 'ECOMMERCE',
          status: 'PAID',
          respCode: '',
          'extras-inputs': [],
          extras: [],
        }
      : { ...common, updatedAt: Date.now(), invoiceStatus: 'EXPIRED' };
  return { type: 'PAYMENT', status, message: '', body };
}

/**
 * Input for {@link signTestGatewayWebhook}.
 *
 * @example
 * ```ts
 * const input: SignTestGatewayWebhookInput = { payload, checksumKey: 'test_checksum_key' };
 * ```
 */
export interface SignTestGatewayWebhookInput {
  /** A payload object (serialized with `JSON.stringify`) or a raw body string, signed as is. */
  payload: Readonly<Record<string, unknown>> | string;
  /** The checksum key. Use a test key, never a real one. */
  checksumKey: string;
}

/**
 * A signed gateway webhook request, ready to send or to pass to `webhooks.verify()`.
 *
 * @example
 * ```ts
 * const { body, headers }: SignedTestGatewayWebhook = await signTestGatewayWebhook(input);
 * ```
 */
export interface SignedTestGatewayWebhook {
  /** The exact body that was signed. */
  body: string;
  /** `content-type` and `x-checksum-v2`. */
  headers: { 'content-type': string; 'x-checksum-v2': string };
}

/**
 * Signs a gateway webhook the way Bonum does (hex HMAC-SHA256 of the body in `X-Checksum-V2`), so
 * you can test your endpoint without Bonum.
 *
 * @example
 * ```ts
 * import { createTestInvoiceWebhook, signTestGatewayWebhook } from 'bonum-psp/testing';
 *
 * const { body, headers } = await signTestGatewayWebhook({
 *   payload: createTestInvoiceWebhook(),
 *   checksumKey: 'test_checksum_key',
 * });
 * await fetch('http://localhost:3000/webhooks/bonum-gateway', { method: 'POST', body, headers });
 * ```
 */
export async function signTestGatewayWebhook(
  input: SignTestGatewayWebhookInput,
): Promise<SignedTestGatewayWebhook> {
  if (typeof input.checksumKey !== 'string' || input.checksumKey === '') {
    throw new BonumConfigError(
      'signTestGatewayWebhook needs a non-empty `checksumKey` (use a test key).',
    );
  }
  const body = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(input.checksumKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-checksum-v2': Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    },
  };
}
