import { describe, expectTypeOf, it } from 'vitest';
import {
  type ApplePayPaymentToken,
  type BonumClient,
  type BonumWebhookEvent,
  type BonumWebhooks,
  type CurrencyCode,
  isTerminalStatus,
  type Payment,
  type PaymentAuthorizedEvent,
  type PaymentFailedEvent,
  type PaymentResult,
  type PaymentStatus,
  type PaymentSubmission,
  type SubmitApplePayParams,
  type SubmitGooglePayParams,
  type WalletType,
  type WebhookPayload,
} from '../src/index.js';
import { createTestWebhookEvent } from '../src/testing.js';

// These assertions run under `tsc --noEmit` (pnpm typecheck); Vitest only executes the bodies.
describe('public types', () => {
  it('requires orderId and token, and keeps optional params `| undefined`', () => {
    expectTypeOf<SubmitApplePayParams['orderId']>().toEqualTypeOf<string>();
    expectTypeOf<SubmitApplePayParams['token']>().toEqualTypeOf<ApplePayPaymentToken | string>();
    expectTypeOf<SubmitApplePayParams['amount']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SubmitGooglePayParams['currency']>().toEqualTypeOf<CurrencyCode>();
    expectTypeOf<SubmitGooglePayParams['token']>().toEqualTypeOf<string>();

    // @ts-expect-error orderId is required
    const missingOrder: SubmitApplePayParams = { token: '{}' };
    // @ts-expect-error Google Pay needs a currency
    const missingCurrency: SubmitGooglePayParams = { orderId: 'ORD-1', token: 'x' };
    // @ts-expect-error the Google Pay token is a string, not an object
    const objectToken: SubmitGooglePayParams = { orderId: 'ORD-1', token: {}, currency: 'MNT' };
    // An explicit `undefined` is fine, with or without exactOptionalPropertyTypes.
    const explicitUndefined: SubmitApplePayParams = {
      orderId: 'ORD-1',
      token: '{}',
      amount: undefined,
    };
    void [missingOrder, missingCurrency, objectToken, explicitUndefined];
  });

  it('describes the responses', () => {
    expectTypeOf<PaymentResult['timedOut']>().toEqualTypeOf<boolean>();
    expectTypeOf<PaymentResult['failureReason']>().toEqualTypeOf<string | null>();
    expectTypeOf<Payment['amount']>().toEqualTypeOf<string>();
    expectTypeOf<PaymentSubmission['status']>().toEqualTypeOf<PaymentStatus>();
    expectTypeOf<PaymentStatus>().toEqualTypeOf<'PENDING' | 'AUTHORIZED' | 'FAILED'>();
  });

  it('keeps wallet types open without losing autocomplete', () => {
    expectTypeOf<'APPLE_PAY'>().toExtend<WalletType>();
    expectTypeOf<'SAMSUNG_PAY'>().toExtend<WalletType>();
  });

  it('narrows with isTerminalStatus', () => {
    const status = 'PENDING' as PaymentStatus;
    if (isTerminalStatus(status)) expectTypeOf(status).toEqualTypeOf<'AUTHORIZED' | 'FAILED'>();
  });

  it('types the payments resource', () => {
    expectTypeOf<BonumClient['payments']['get']>().returns.resolves.toEqualTypeOf<Payment>();
    expectTypeOf<BonumClient['payments']['waitForResult']>()
      .parameter(0)
      .toEqualTypeOf<string | Pick<PaymentSubmission, 'paymentId'>>();
  });

  it('narrows webhook events on eventType', () => {
    const event = { eventType: 'FAILED' } as BonumWebhookEvent;
    if (event.eventType === 'FAILED') {
      expectTypeOf(event).toEqualTypeOf<PaymentFailedEvent>();
      expectTypeOf(event.status).toEqualTypeOf<'FAILED'>();
    } else {
      expectTypeOf(event).toEqualTypeOf<PaymentAuthorizedEvent>();
    }
    expectTypeOf<BonumWebhooks['verify']>().parameter(0).toEqualTypeOf<WebhookPayload>();
  });

  it('infers the event type created by the testing helper', () => {
    expectTypeOf(createTestWebhookEvent()).toEqualTypeOf<PaymentAuthorizedEvent>();
    expectTypeOf(
      createTestWebhookEvent({ eventType: 'FAILED' }),
    ).toEqualTypeOf<PaymentFailedEvent>();
  });
});
