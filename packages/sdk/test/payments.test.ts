import { describe, expect, it, vi } from 'vitest';
import {
  BonumServerError,
  BonumUnexpectedResponseError,
  BonumValidationError,
  isTerminalStatus,
  normalizeCurrency,
  type SubmitApplePayParams,
  type SubmitGooglePayParams,
} from '../src/index.js';
import {
  applePayToken,
  fakeFetch,
  googlePayToken,
  json,
  ORDER_ID,
  PAYMENT_ID,
  paymentBody,
  SANDBOX,
  sentBody,
  submissionBody,
  testClient,
} from './helpers.js';

function setup(...replies: Parameters<typeof fakeFetch>) {
  const fetch = fakeFetch(...(replies.length > 0 ? replies : [json(submissionBody)]));
  return { fetch, ...testClient(fetch) };
}

async function validationError(promise: Promise<unknown>): Promise<BonumValidationError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BonumValidationError);
  return error as BonumValidationError;
}

describe('payments.submitApplePay', () => {
  it('posts a snake_case body and passes the token through untouched', async () => {
    const { client, fetch } = setup();
    const token = structuredClone(applePayToken);
    const submission = await client.payments.submitApplePay({
      orderId: ORDER_ID,
      token,
      amount: 150.5,
      branchId: 'UB-01',
    });
    expect(fetch.calls[0]?.url).toBe(`${SANDBOX}/api/v2/payment/process`);
    expect(fetch.calls[0]?.body).toEqual({
      order_id: ORDER_ID,
      token: applePayToken,
      amount: 150.5,
      branch_id: 'UB-01',
    });
    expect(token).toEqual(applePayToken);
    expect(submission).toEqual(submissionBody);
  });

  it('leaves optional fields out entirely', async () => {
    const { client, fetch } = setup();
    await client.payments.submitApplePay({ orderId: ORDER_ID, token: applePayToken });
    expect(Object.keys(sentBody(fetch))).toEqual(['order_id', 'token']);
  });

  it('accepts the token as a JSON string', async () => {
    const { client, fetch } = setup();
    await client.payments.submitApplePay({
      orderId: ORDER_ID,
      token: JSON.stringify(applePayToken),
    });
    expect(sentBody(fetch).token).toEqual(applePayToken);
  });

  it.each([
    ['a non-JSON string', 'not json', 'not a JSON object'],
    ['a JSON array', '[1,2]', 'not a JSON object'],
    ['a number', 42, 'token must be an object'],
    ['only paymentData', applePayToken.paymentData, 'token.paymentData only'],
    ['the whole ApplePayPayment', { token: applePayToken }, 'ApplePayPayment object'],
    [
      'a token without transactionIdentifier',
      { ...applePayToken, transactionIdentifier: 1 },
      'missing',
    ],
  ])('rejects %s with a hint', async (_label, token, hint) => {
    const { client, fetch } = setup();
    const params = { orderId: ORDER_ID, token } as unknown as SubmitApplePayParams;
    const error = await validationError(client.payments.submitApplePay(params));
    expect(error.field).toBe('token');
    expect(error.message).toContain(hint);
    expect(error.message).toContain('PKPaymentToken');
    expect(fetch.calls).toHaveLength(0);
  });

  it('accepts an idempotent replay that is already AUTHORIZED', async () => {
    const { client } = setup(json({ ...submissionBody, status: 'AUTHORIZED' }));
    const submission = await client.payments.submitApplePay({
      orderId: ORDER_ID,
      token: applePayToken,
    });
    expect(submission.status).toBe('AUTHORIZED');
  });

  it('retries a submission after a server error (order_id makes it idempotent)', async () => {
    const { client, fetch } = setup(json({ message: 'oops' }, 502), json(submissionBody));
    await client.payments.submitApplePay({ orderId: ORDER_ID, token: applePayToken });
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[1]?.body).toEqual(fetch.calls[0]?.body);
  });

  it('flags an unexpected submission response and says the payment may exist', async () => {
    const { client } = setup(json({ ...submissionBody, status: 'QUEUED' }));
    const error = await client.payments
      .submitApplePay({ orderId: ORDER_ID, token: applePayToken })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BonumUnexpectedResponseError);
    expect((error as Error).message).toContain(
      '"status" should be one of PENDING, AUTHORIZED, FAILED',
    );
    expect((error as Error).message).toContain('look it up by orderId');
  });
});

describe('payments.submitGooglePay', () => {
  it('posts a snake_case body with the token string unchanged', async () => {
    const { client, fetch } = setup();
    await client.payments.submitGooglePay({
      orderId: ORDER_ID,
      token: googlePayToken,
      currency: 'MNT',
      amount: 150.5,
      branchId: 'UB-01',
    });
    expect(fetch.calls[0]?.url).toBe(`${SANDBOX}/api/v2/payment/process/google`);
    expect(fetch.calls[0]?.body).toEqual({
      order_id: ORDER_ID,
      token: googlePayToken,
      currency_code: 'MNT',
      amount: 150.5,
      branch_id: 'UB-01',
    });
  });

  it('leaves optional fields out entirely', async () => {
    const { client, fetch } = setup();
    await client.payments.submitGooglePay({
      orderId: ORDER_ID,
      token: googlePayToken,
      currency: 'USD',
    });
    expect(Object.keys(sentBody(fetch))).toEqual(['order_id', 'token', 'currency_code']);
  });

  it.each([
    ['an object', JSON.parse(googlePayToken), 'do not JSON.parse it'],
    ['an empty string', ' ', 'do not JSON.parse it'],
    [
      'the whole PaymentData',
      JSON.stringify({ paymentMethodData: { tokenizationData: {} } }),
      'whole Google Pay PaymentData',
    ],
  ])('rejects %s as the token', async (_label, token, hint) => {
    const { client } = setup();
    const params = {
      orderId: ORDER_ID,
      token,
      currency: 'MNT',
    } as unknown as SubmitGooglePayParams;
    const error = await validationError(client.payments.submitGooglePay(params));
    expect(error.field).toBe('token');
    expect(error.message).toContain(hint);
  });

  it.each(['mnt', 'GBP', undefined])('rejects currency %s', async (currency) => {
    const { client } = setup();
    const params = {
      orderId: ORDER_ID,
      token: googlePayToken,
      currency,
    } as unknown as SubmitGooglePayParams;
    expect((await validationError(client.payments.submitGooglePay(params))).field).toBe('currency');
  });
});

describe('client-side validation', () => {
  const submit = (overrides: Record<string, unknown>) => {
    const { client, fetch } = setup();
    const params = {
      orderId: ORDER_ID,
      token: applePayToken,
      ...overrides,
    } as SubmitApplePayParams;
    return { promise: client.payments.submitApplePay(params), fetch };
  };

  it.each([0.01, 150.5, 150.5, 1, 99_999_999.99])('accepts amount %s', async (amount) => {
    const { promise, fetch } = submit({ amount });
    await promise;
    expect(sentBody(fetch).amount).toBe(amount);
  });

  it.each([0, 0.001, -1, 1.005, Number.NaN, Number.POSITIVE_INFINITY, 1e-7, '150.5', null])(
    'rejects amount %s before calling Bonum',
    async (amount) => {
      const { promise, fetch } = submit({ amount });
      expect((await validationError(promise)).field).toBe('amount');
      expect(fetch.calls).toHaveLength(0);
    },
  );

  it('checks orderId and branchId lengths', async () => {
    await expect(submit({ orderId: 'x'.repeat(128) }).promise).resolves.toBeDefined();
    await expect(submit({ branchId: 'b'.repeat(64) }).promise).resolves.toBeDefined();
    for (const [field, value] of [
      ['orderId', ''],
      ['orderId', 'x'.repeat(129)],
      ['orderId', 1001],
      ['branchId', ''],
      ['branchId', 'b'.repeat(65)],
    ] as const) {
      const error = await validationError(submit({ [field]: value }).promise);
      expect(error.field).toBe(field);
    }
  });

  it('rejects params and options that are not objects', async () => {
    const { client } = setup();
    const params = null as unknown as SubmitApplePayParams;
    expect((await validationError(client.payments.submitApplePay(params))).field).toBe('params');
    const options = 'fast' as unknown as { timeoutMs: number };
    expect((await validationError(client.payments.get(PAYMENT_ID, options))).field).toBe('options');
  });

  it('validates per-request options', async () => {
    const { client } = setup();
    for (const [options, field] of [
      [{ timeoutMs: 0 }, 'timeoutMs'],
      [{ timeoutMs: 2.5 }, 'timeoutMs'],
      [{ signal: { aborted: false } }, 'signal'],
    ] as const) {
      const error = await validationError(client.payments.get(PAYMENT_ID, options as never));
      expect(error.field).toBe(field);
    }
  });
});

describe('payments.get and payments.getByOrderId', () => {
  it('gets a payment by id', async () => {
    const { client, fetch } = setup(json(paymentBody));
    await expect(client.payments.get(PAYMENT_ID)).resolves.toEqual(paymentBody);
    expect(fetch.calls[0]?.url).toBe(`${SANDBOX}/api/v2/payments/${PAYMENT_ID}`);
  });

  it.each(['not-a-uuid', `${PAYMENT_ID}/../x`, '', 42])('rejects payment id %s', async (id) => {
    const { client, fetch } = setup();
    expect((await validationError(client.payments.get(id as string))).field).toBe('paymentId');
    expect(fetch.calls).toHaveLength(0);
  });

  it('accepts an upper-case UUID', async () => {
    const { client } = setup(json(paymentBody));
    await expect(client.payments.get(PAYMENT_ID.toUpperCase())).resolves.toBeDefined();
  });

  it('percent-encodes the order id in the query string', async () => {
    const { client, fetch } = setup(json(paymentBody));
    await client.payments.getByOrderId('ORD 1/2&3+4=5?ö');
    expect(fetch.calls[0]?.url).toBe(
      `${SANDBOX}/api/v2/payments/lookup/by-order-id?orderId=ORD%201%2F2%263%2B4%3D5%3F%C3%B6`,
    );
  });

  it('refuses to guess when the order lookup returns a list', async () => {
    const { client } = setup(json([{ ...paymentBody, status: 'FAILED' }, paymentBody]));
    await expect(client.payments.getByOrderId(ORDER_ID)).rejects.toThrow(/list of payments/);
  });

  it('defaults missing providerReference and failureReason to null', async () => {
    const { providerReference: _p, failureReason: _f, ...body } = paymentBody;
    const { client } = setup(json({ ...body, status: 'PENDING' }));
    await expect(client.payments.get(PAYMENT_ID)).resolves.toMatchObject({
      providerReference: null,
      failureReason: null,
    });
  });

  it('keeps numeric amounts and currencies as their exact decimal text', async () => {
    const { client } = setup(json({ ...paymentBody, amount: 150.5, currency: 496 }));
    const payment = await client.payments.get(PAYMENT_ID);
    expect(payment.amount).toBe('150.5');
    expect(payment.currency).toBe('496');
    expect(normalizeCurrency(payment.currency)).toBe('MNT');
  });

  it('accepts wallet types the SDK does not know yet', async () => {
    const { client } = setup(json({ ...paymentBody, walletType: 'SAMSUNG_PAY' }));
    await expect(client.payments.get(PAYMENT_ID)).resolves.toMatchObject({
      walletType: 'SAMSUNG_PAY',
    });
  });

  it.each([
    [{ status: 'REFUNDED' }, '"status" should be one of'],
    [{ amount: null }, '"amount" should be a string, got null'],
    [{ failureReason: 7 }, '"failureReason" should be a string or null'],
    [{ updatedAt: undefined }, '"updatedAt" should be a string, got nothing'],
  ])('validates the payment shape %o', async (overrides, message) => {
    const { client } = setup(json({ ...paymentBody, ...overrides }));
    await expect(client.payments.get(PAYMENT_ID)).rejects.toThrow(message);
  });

  it('rejects a payment that is not an object', async () => {
    const { client } = setup(json('AUTHORIZED'));
    await expect(client.payments.get(PAYMENT_ID)).rejects.toThrow('expected a JSON object');
  });

  it('shortens long values in error messages', async () => {
    const { client } = setup(json({ ...paymentBody, orderId: { nested: 'y'.repeat(100) } }));
    await expect(client.payments.get(PAYMENT_ID)).rejects.toThrow(/got \{"nested":"y+…/);
  });
});

describe('payments.waitForResult', () => {
  const result = { paymentId: PAYMENT_ID, status: 'AUTHORIZED', failureReason: null };

  it('long-polls with the default wait and an HTTP timeout 5 s longer', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { client, fetch } = setup(json(result));
    await expect(client.payments.waitForResult(PAYMENT_ID)).resolves.toEqual({
      ...result,
      timedOut: false,
    });
    expect(fetch.calls[0]?.url).toBe(
      `${SANDBOX}/api/v2/payments/${PAYMENT_ID}/await?timeoutMs=25000`,
    );
    expect(timeout).toHaveBeenCalledWith(30_000);
  });

  it('accepts a submission object and a custom wait', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { client, fetch } = setup(json(result));
    await client.payments.waitForResult(submissionBody, { waitMs: 28_000 });
    expect(fetch.calls[0]?.url).toContain('/await?timeoutMs=28000');
    expect(timeout).toHaveBeenCalledWith(33_000);
  });

  it('normalizes timedOut', async () => {
    const pending = {
      paymentId: PAYMENT_ID,
      status: 'PENDING',
      failureReason: null,
      timedOut: true,
    };
    const { client } = setup(json(pending), json({ ...pending, timedOut: 'yes' }));
    await expect(client.payments.waitForResult(PAYMENT_ID)).resolves.toMatchObject({
      timedOut: true,
    });
    await expect(client.payments.waitForResult(PAYMENT_ID)).rejects.toThrow(
      '"timedOut" should be a boolean',
    );
  });

  it('is never retried, to fit the wallet sheet time limit', async () => {
    const { client, fetch } = setup(json({ message: 'unavailable' }, 503), json(result));
    await expect(client.payments.waitForResult(PAYMENT_ID)).rejects.toThrow(BonumServerError);
    expect(fetch.calls).toHaveLength(1);
  });

  it.each([0, 28_001, 1.5, '25000', null])('rejects waitMs %s', async (waitMs) => {
    const { client } = setup(json(result));
    const error = await validationError(
      client.payments.waitForResult(PAYMENT_ID, { waitMs } as { waitMs: number }),
    );
    expect(error.field).toBe('waitMs');
  });

  it('validates the payment id from a string or an object', async () => {
    const { client } = setup(json(result));
    for (const payment of ['nope', { paymentId: 'nope' }, null]) {
      const error = await validationError(client.payments.waitForResult(payment as string));
      expect(error.field).toBe('paymentId');
    }
  });

  it('passes the caller signal through', async () => {
    const { client } = setup(json(result));
    await expect(
      client.payments.waitForResult(PAYMENT_ID, { signal: AbortSignal.abort('closed') }),
    ).rejects.toBe('closed');
    const error = await validationError(
      client.payments.waitForResult(PAYMENT_ID, { signal: 'stop' } as never),
    );
    expect(error.field).toBe('signal');
  });
});

describe('helpers', () => {
  it('isTerminalStatus is true only for AUTHORIZED and FAILED', () => {
    expect(['PENDING', 'AUTHORIZED', 'FAILED', 'OTHER'].map(isTerminalStatus)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it('normalizeCurrency maps numeric codes and passes everything else through', () => {
    expect(
      ['496', '840', '978', '392', ' 496 ', 'MNT', 'usd', '156', 'toString'].map(normalizeCurrency),
    ).toEqual(['MNT', 'USD', 'EUR', 'JPY', 'MNT', 'MNT', 'usd', '156', 'toString']);
  });
});
