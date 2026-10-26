import { BonumConfigError } from './errors.js';
import type {
  BonumWebhookEvent,
  PaymentAuthorizedEvent,
  PaymentFailedEvent,
  WebhookEventBase,
  WebhookEventType,
} from './webhooks/event.js';

const encoder = new TextEncoder();

/**
 * Field overrides for {@link createTestWebhookEvent}. `eventType` picks the event and its defaults.
 *
 * @example
 * ```ts
 * const overrides: TestWebhookEventOverrides<'FAILED'> = { eventType: 'FAILED', amount: '99.00' };
 * ```
 */
export type TestWebhookEventOverrides<T extends WebhookEventType = WebhookEventType> = {
  [K in keyof WebhookEventBase]?: WebhookEventBase[K] | undefined;
} & { eventType?: T | undefined };

/**
 * The event type created for the given overrides: `PaymentFailedEvent` for `'FAILED'`.
 *
 * @example
 * ```ts
 * const event: TestWebhookEvent<'FAILED'> = createTestWebhookEvent({ eventType: 'FAILED' });
 * ```
 */
export type TestWebhookEvent<T extends WebhookEventType> = T extends 'FAILED'
  ? PaymentFailedEvent
  : PaymentAuthorizedEvent;

/**
 * Builds a realistic webhook event with fresh UUIDs. `AUTHORIZED` by default; a `FAILED` event gets
 * a `failureReason` and no `providerReference`. Use it in your own tests.
 *
 * @example
 * ```ts
 * import { createTestWebhookEvent } from 'bonum-psp/testing';
 *
 * const event = createTestWebhookEvent({ eventType: 'FAILED', orderId: 'ORD-1001' });
 * ```
 */
export function createTestWebhookEvent<T extends WebhookEventType = 'AUTHORIZED'>(
  overrides: TestWebhookEventOverrides<T> = {},
): TestWebhookEvent<T> {
  const { eventType = 'AUTHORIZED', ...fields } = overrides;
  const failed = eventType === 'FAILED';
  const event = {
    webhookId: crypto.randomUUID(),
    paymentId: crypto.randomUUID(),
    orderId: `ORD-TEST-${crypto.randomUUID().slice(0, 8)}`,
    eventType,
    status: eventType,
    amount: '150.50',
    currency: 'MNT',
    providerReference: failed ? null : `TEST-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
    failureReason: failed ? 'Declined by issuer (test event)' : null,
    occurredAt: new Date().toISOString(),
    walletType: 'APPLE_PAY',
    binCategory: 'DOMESTIC',
    ...withoutUndefined(fields),
  };
  return event as TestWebhookEvent<T>;
}

/**
 * Input for {@link signTestWebhook}.
 *
 * @example
 * ```ts
 * const input: SignTestWebhookInput = { payload: event, secret: 'test_webhook_secret' };
 * ```
 */
export interface SignTestWebhookInput {
  /** An event object (serialized with `JSON.stringify`) or a raw body string, signed as is. */
  payload: BonumWebhookEvent | Readonly<Record<string, unknown>> | string;
  /** The webhook signing secret. Use a test secret, never a real one. */
  secret: string;
  /** Unix seconds for `X-PSP-Timestamp`. Defaults to now. */
  timestamp?: number | undefined;
}

/**
 * A signed webhook request, ready to send or to pass to `webhooks.verify()`.
 *
 * @example
 * ```ts
 * const { body, headers }: SignedTestWebhook = await signTestWebhook({ payload, secret });
 * ```
 */
export interface SignedTestWebhook {
  /** The exact body that was signed. */
  body: string;
  /** `content-type`, `x-psp-signature` and `x-psp-timestamp`. */
  headers: {
    'content-type': string;
    'x-psp-signature': string;
    'x-psp-timestamp': string;
  };
}

/**
 * Signs a webhook the way Bonum does (HMAC-SHA256 over `${timestamp}.${body}`, sent as `v1=<hex>`),
 * so you can test your endpoint without Bonum.
 *
 * @example
 * ```ts
 * import { createTestWebhookEvent, signTestWebhook } from 'bonum-psp/testing';
 *
 * const { body, headers } = await signTestWebhook({
 *   payload: createTestWebhookEvent(),
 *   secret: 'test_webhook_secret',
 * });
 * await fetch('http://localhost:3000/webhooks/bonum', { method: 'POST', body, headers });
 * ```
 */
export async function signTestWebhook(input: SignTestWebhookInput): Promise<SignedTestWebhook> {
  if (typeof input.secret !== 'string' || input.secret === '') {
    throw new BonumConfigError('signTestWebhook needs a non-empty `secret` (use a test secret).');
  }
  const seconds = input.timestamp ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new BonumConfigError('signTestWebhook `timestamp` must be Unix time in whole seconds.');
  }
  const body = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload);
  const timestamp = String(seconds);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-psp-signature': `v1=${toHex(new Uint8Array(digest))}`,
      'x-psp-timestamp': timestamp,
    },
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function withoutUndefined<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export {
  createTestInvoiceWebhook,
  type SignedTestGatewayWebhook,
  type SignTestGatewayWebhookInput,
  signTestGatewayWebhook,
  type TestInvoiceWebhookOverrides,
} from './gateway/testing.js';
