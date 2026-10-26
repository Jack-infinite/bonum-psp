import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  BonumAPIError,
  BonumAuthenticationError,
  BonumBadRequestError,
  BonumConnectionError,
  BonumNotFoundError,
  BonumRateLimitError,
  BonumServerError,
  BonumTimeoutError,
  BonumUnexpectedResponseError,
  VERSION,
} from '../src/index.js';
import { parseRetryAfterMs, retryDelayMs, sleep } from '../src/retry.js';
import {
  applePayToken,
  fakeFetch,
  hangingFetch,
  json,
  MERCHANT_KEY,
  ORDER_ID,
  PAYMENT_ID,
  paymentBody,
  SANDBOX,
  submissionBody,
  testClient,
} from './helpers.js';

const errorJson = (status: number, message: string | string[]): Response =>
  json({ statusCode: status, message, error: 'Error' }, status);

describe('HTTP layer', () => {
  it('sends exactly the documented headers on GET', async () => {
    const fetch = fakeFetch(json(paymentBody));
    const { client } = testClient(fetch);
    await client.payments.get(PAYMENT_ID);
    const [call] = fetch.calls;
    expect(call?.url).toBe(`${SANDBOX}/api/v2/payments/${PAYMENT_ID}`);
    expect(call?.init.method).toBe('GET');
    expect(call?.headers).toEqual({
      accept: 'application/json',
      'user-agent': `bonum-psp/${VERSION}`,
      'x-merchant-key': MERCHANT_KEY,
    });
    expect(call?.init.body).toBeUndefined();
  });

  it('adds content-type on POST', async () => {
    const fetch = fakeFetch(json(submissionBody));
    const { client } = testClient(fetch);
    await client.payments.submitApplePay({ orderId: ORDER_ID, token: applePayToken });
    expect(fetch.calls[0]?.init.method).toBe('POST');
    expect(fetch.calls[0]?.headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': `bonum-psp/${VERSION}`,
      'x-merchant-key': MERCHANT_KEY,
    });
  });

  it('never follows redirects', async () => {
    const fetch = fakeFetch(
      new Response(null, { status: 302, headers: { location: 'https://evil.example' } }),
    );
    const { client } = testClient(fetch);
    const error = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect(fetch.calls[0]?.init.redirect).toBe('manual');
    expect(error).toBeInstanceOf(BonumUnexpectedResponseError);
    expect((error as Error).message).toContain('redirect (HTTP 302)');
    expect(fetch.calls).toHaveLength(1);
  });

  it('treats an opaque redirect (browser-style fetch) as an error', async () => {
    const opaque = { type: 'opaqueredirect', status: 0, ok: false, text: async () => '' };
    const fetch = fakeFetch(() => opaque as unknown as Response);
    const { client } = testClient(fetch);
    await expect(client.payments.get(PAYMENT_ID)).rejects.toThrow(BonumUnexpectedResponseError);
  });

  it('maps a timeout to BonumTimeoutError and retries it', async () => {
    const fetch = hangingFetch();
    const { client, delays } = testClient(fetch, { timeoutMs: 20, maxRetries: 1 });
    const error = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BonumTimeoutError);
    expect((error as BonumTimeoutError).code).toBe('timeout');
    expect((error as Error).message).toContain('within 20 ms');
    expect(fetch.calls).toBe(2);
    expect(delays).toEqual([250]);
  });

  it('warns that a timed-out submission may still have gone through', async () => {
    const { client } = testClient(hangingFetch(), { timeoutMs: 20, maxRetries: 0 });
    await expect(
      client.payments.submitApplePay({ orderId: ORDER_ID, token: applePayToken }),
    ).rejects.toThrow(/may still have been created/);
  });

  it('rethrows the caller abort reason without retrying', async () => {
    const fetch = hangingFetch();
    const { client } = testClient(fetch, { maxRetries: 2 });
    const controller = new AbortController();
    const reason = new Error('customer closed the sheet');
    const pending = client.payments.get(PAYMENT_ID, { signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(fetch.calls).toBe(1);
  });

  it('rethrows the abort reason when the signal is already aborted', async () => {
    const fetch = fakeFetch(json(paymentBody));
    const { client } = testClient(fetch);
    const signal = AbortSignal.abort('stop');
    await expect(client.payments.get(PAYMENT_ID, { signal })).rejects.toBe('stop');
  });

  it('stops waiting between retries when the caller aborts', async () => {
    const controller = new AbortController();
    const fetch = fakeFetch(() => {
      setTimeout(() => controller.abort('deadline'), 5);
      return json({ message: 'busy' }, 503);
    });
    const { client } = testClient(fetch, { sleep });
    await expect(client.payments.get(PAYMENT_ID, { signal: controller.signal })).rejects.toBe(
      'deadline',
    );
    expect(fetch.calls).toHaveLength(1);
  });

  it('maps network failures to BonumConnectionError with the cause', async () => {
    const cause = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:443'),
    });
    const fetch = fakeFetch(cause);
    const { client, delays } = testClient(fetch);
    const error = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BonumConnectionError);
    expect((error as BonumConnectionError).cause).toBe(cause);
    expect((error as Error).message).toContain('fetch failed (connect ECONNREFUSED');
    expect(fetch.calls).toHaveLength(3);
    expect(delays).toEqual([250, 500]);
  });

  it('describes non-Error rejections', async () => {
    const fetch = fakeFetch(() => Promise.reject('socket hang up'));
    const { client } = testClient(fetch, { maxRetries: 0 });
    await expect(client.payments.get(PAYMENT_ID)).rejects.toThrow(/socket hang up/);
  });

  it.each([429, 500, 502, 503, 504])('retries HTTP %i with exponential backoff', async (status) => {
    const fetch = fakeFetch(json({ message: 'try later' }, status), json(paymentBody));
    const { client, delays } = testClient(fetch);
    await expect(client.payments.get(PAYMENT_ID)).resolves.toMatchObject({ status: 'AUTHORIZED' });
    expect(fetch.calls).toHaveLength(2);
    expect(delays).toEqual([250]);
  });

  it('caps the backoff at 8 seconds with full jitter', () => {
    expect([0, 1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, null, () => 1))).toEqual([
      500, 1000, 2000, 4000, 8000, 8000,
    ]);
    expect(retryDelayMs(3, null, () => 0)).toBe(0);
  });

  it('honors Retry-After in seconds, capped at 60 seconds', async () => {
    const fetch = fakeFetch(
      json({ message: 'slow down' }, 429, { 'retry-after': '2' }),
      json({ message: 'slow down' }, 429, { 'retry-after': '120' }),
      json({ message: 'slow down' }, 429, { 'retry-after': '120' }),
    );
    const { client, delays } = testClient(fetch);
    const error = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect(delays).toEqual([2000, 60_000]);
    expect(error).toBeInstanceOf(BonumRateLimitError);
    expect((error as BonumRateLimitError).retryAfterMs).toBe(120_000);
  });

  it('parses Retry-After as an HTTP date', () => {
    const now = Date.parse('2026-10-26T04:00:00Z');
    expect(parseRetryAfterMs('Mon, 26 Oct 2026 04:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfterMs('Mon, 26 Oct 2026 03:59:00 GMT', now)).toBe(0);
    expect(parseRetryAfterMs('soon', now)).toBeNull();
    expect(parseRetryAfterMs(null, now)).toBeNull();
  });

  it('reports a rate limit without Retry-After as retryAfterMs null', async () => {
    const { client } = testClient(fakeFetch(json({ message: 'slow down' }, 429)), {
      maxRetries: 0,
    });
    const error = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect((error as BonumRateLimitError).retryAfterMs).toBeNull();
  });

  it.each([
    [400, BonumBadRequestError],
    [401, BonumAuthenticationError],
    [404, BonumNotFoundError],
    [403, BonumAPIError],
    [409, BonumAPIError],
    [501, BonumServerError],
  ])('does not retry HTTP %i and throws the matching class', async (status, ErrorClass) => {
    const fetch = fakeFetch(errorJson(status, 'nope'));
    const { client } = testClient(fetch);
    const error = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect(fetch.calls).toHaveLength(1);
    expect(error).toBeInstanceOf(ErrorClass);
    expect((error as Error).name).toBe(ErrorClass.name);
    expect(error).toMatchObject({
      code: 'api_error',
      status,
      method: 'GET',
      path: `/api/v2/payments/${PAYMENT_ID}`,
    });
  });

  it.each([
    [500, BonumServerError],
    [503, BonumServerError],
    [429, BonumRateLimitError],
  ])('throws the matching class for HTTP %i once retries run out', async (status, ErrorClass) => {
    const fetch = fakeFetch(errorJson(status, 'busy'));
    const { client } = testClient(fetch);
    await expect(client.payments.get(PAYMENT_ID)).rejects.toThrow(ErrorClass);
    expect(fetch.calls).toHaveLength(3);
  });

  it('uses the error message string, or joins a validation array', async () => {
    const { client } = testClient(
      fakeFetch(
        errorJson(400, 'order_id must be shorter than or equal to 128 characters.'),
        errorJson(400, [
          'currency_code must be one of MNT, USD',
          'amount must not be less than 0.01',
        ]),
      ),
    );
    await expect(client.payments.get(PAYMENT_ID)).rejects.toThrow(
      `Bonum returned HTTP 400 for GET /api/v2/payments/${PAYMENT_ID}: order_id must be shorter than or equal to 128 characters. Check`,
    );
    await expect(client.payments.get(PAYMENT_ID)).rejects.toThrow(
      'currency_code must be one of MNT, USD; amount must not be less than 0.01.',
    );
  });

  it('falls back to the error name, a text body or nothing', async () => {
    const longText = 'x'.repeat(600);
    const { client } = testClient(
      fakeFetch(
        json({ statusCode: 404, error: 'Not Found' }, 404),
        new Response(longText, { status: 400 }),
        new Response('', { status: 401 }),
        json({ statusCode: 403 }, 403),
      ),
    );
    await expect(client.payments.get(PAYMENT_ID)).rejects.toThrow(': Not Found.');
    const text = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect((text as BonumAPIError).body).toBe(`${'x'.repeat(500)}…`);
    const empty = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect((empty as BonumAPIError).body).toBeNull();
    expect((empty as Error).message).toContain('HTTP 401 for GET');
    expect((empty as Error).message).toContain('BONUM_MERCHANT_KEY');
    const bare = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect((bare as Error).message).toBe(
      `Bonum returned HTTP 403 for GET /api/v2/payments/${PAYMENT_ID}.`,
    );
  });

  it('rejects a 2xx body that is not JSON', async () => {
    const { client } = testClient(fakeFetch(new Response('<html>maintenance</html>')));
    const error = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BonumUnexpectedResponseError);
    expect((error as BonumUnexpectedResponseError).body).toBe('<html>maintenance</html>');
  });

  it('rejects a 2xx body with the wrong shape, without retrying', async () => {
    const fetch = fakeFetch(json({ ...paymentBody, orderId: 42 }));
    const { client } = testClient(fetch);
    const error = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BonumUnexpectedResponseError);
    expect((error as Error).message).toContain('"orderId" should be a string, got 42');
    expect((error as BonumUnexpectedResponseError).body).toEqual({ ...paymentBody, orderId: 42 });
    expect(fetch.calls).toHaveLength(1);
  });

  it('keeps the merchant key out of errors', async () => {
    const { client } = testClient(fakeFetch(errorJson(401, 'Invalid or inactive request key')));
    const error = await client.payments.get(PAYMENT_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BonumAuthenticationError);
    const views = [
      String(error),
      JSON.stringify(error),
      inspect(error, { depth: Number.POSITIVE_INFINITY }),
    ];
    for (const view of views) expect(view).not.toContain(MERCHANT_KEY);
  });

  it('uses the per-request timeout when given', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { client } = testClient(fakeFetch(json(paymentBody)), { timeoutMs: 9_000 });
    await client.payments.get(PAYMENT_ID);
    await client.payments.get(PAYMENT_ID, { timeoutMs: 1_234 });
    expect(timeout.mock.calls).toEqual([[9_000], [1_234]]);
  });
});

describe('sleep', () => {
  it('resolves after the delay and rejects at once for an aborted signal', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
    await expect(sleep(1, AbortSignal.abort('gone'))).rejects.toBe('gone');
    const controller = new AbortController();
    const waiting = sleep(10_000, controller.signal);
    controller.abort('cancelled');
    await expect(waiting).rejects.toBe('cancelled');
    await expect(sleep(1, new AbortController().signal)).resolves.toBeUndefined();
  });
});
