import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BONUM_GATEWAY_BASE_URLS,
  BonumAPIError,
  BonumAuthenticationError,
  BonumBadRequestError,
  BonumConfigError,
  BonumGatewayClient,
  BonumServerError,
  BonumTimeoutError,
  BonumUnexpectedResponseError,
} from '../src/index.js';
import {
  APP_SECRET,
  fakeFetch,
  GATEWAY,
  hangingFetch,
  INVOICES_PATH,
  invoiceBody,
  json,
  pathOf,
  REFRESH_PATH,
  type RecordedCall,
  TERMINAL_ID,
  TOKEN_PATH,
  testGateway,
  tokenGrant,
} from './helpers.js';

const params = { amount: 5000, transactionId: 'ORD-1001', expiresIn: 900 };

/** Answers token requests with fresh grants and everything else with `reply`. */
function gatewayFetch(reply: (call: RecordedCall) => Response | Promise<Response>) {
  let grants = 0;
  return fakeFetch((call) => {
    if (call.url.includes('/auth/')) {
      grants += 1;
      return json(tokenGrant(grants));
    }
    return reply(call);
  });
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a rejection');
}

describe('BonumGatewayClient configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads credentials and environment from the environment', () => {
    vi.stubEnv('BONUM_GATEWAY_APP_SECRET', `${APP_SECRET}\n`);
    vi.stubEnv('BONUM_GATEWAY_TERMINAL_ID', ` ${TERMINAL_ID}`);
    vi.stubEnv('BONUM_ENV', 'production');
    const gateway = new BonumGatewayClient();
    expect(gateway.environment).toBe('production');
    expect(gateway.baseUrl).toBe(BONUM_GATEWAY_BASE_URLS.production);
    expect(gateway.terminalId).toBe(TERMINAL_ID);
  });

  it.each([
    [{ appSecret: undefined }, 'BONUM_GATEWAY_APP_SECRET'],
    [{ terminalId: '' }, 'BONUM_GATEWAY_TERMINAL_ID'],
    [{ environment: undefined }, 'BONUM_ENV'],
    [{ now: 5 }, 'now must be a function'],
  ])('rejects %o and says what to set', (override, hint) => {
    const create = () => testGateway(fakeFetch(), override as never);
    expect(create).toThrow(BonumConfigError);
    expect(create).toThrow(hint);
  });

  it('rejects secrets with inner whitespace without echoing them', () => {
    const error = rejectionSync(() => testGateway(fakeFetch(), { appSecret: 'app secret_x' }));
    expect(error.message).not.toContain('secret_x');
  });

  it('never exposes the app secret or tokens', async () => {
    const fetch = gatewayFetch(() => json(invoiceBody));
    const { gateway } = testGateway(fetch);
    await gateway.invoices.create(params);
    for (const dump of [
      JSON.stringify(gateway),
      inspect(gateway, { depth: 10, showHidden: true }),
    ]) {
      expect(dump).not.toContain(APP_SECRET);
      expect(dump).not.toContain('access-1');
      expect(dump).not.toContain('refresh-1');
    }
  });

  it('validates an explicit checksum key at once and reads the env one lazily', () => {
    expect(() => testGateway(fakeFetch(), { checksumKey: ' ' })).toThrow(BonumConfigError);
    const { gateway } = testGateway(fakeFetch());
    expect(() => gateway.webhooks).toThrow('BONUM_GATEWAY_CHECKSUM_KEY');
    vi.stubEnv('BONUM_GATEWAY_CHECKSUM_KEY', 'test_checksum_key');
    expect(gateway.webhooks).toBe(gateway.webhooks);
  });
});

function rejectionSync(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected an error');
}

describe('gateway access tokens', () => {
  it('gets a token with the app secret and terminal id, then sends it as a bearer token', async () => {
    const fetch = gatewayFetch(() => json(invoiceBody));
    const { gateway } = testGateway(fetch);
    await gateway.invoices.create(params);
    expect(fetch.calls.map((call) => call.url)).toEqual([
      `${GATEWAY}${TOKEN_PATH}`,
      `${GATEWAY}${INVOICES_PATH}`,
    ]);
    expect(fetch.calls[0]?.init.method).toBe('GET');
    expect(fetch.calls[0]?.headers).toMatchObject({
      authorization: `AppSecret ${APP_SECRET}`,
      'x-terminal-id': TERMINAL_ID,
    });
    expect(fetch.calls[1]?.headers.authorization).toBe('Bearer access-1');
    expect(fetch.calls[1]?.headers).not.toHaveProperty('x-terminal-id');
    expect(fetch.calls[0]?.init.redirect).toBe('manual');
  });

  it('reuses one token for many requests, also when they run concurrently', async () => {
    const fetch = gatewayFetch(() => json([]));
    const { gateway } = testGateway(fetch);
    await Promise.all([gateway.invoices.listProviders(), gateway.invoices.listProviders()]);
    await gateway.invoices.listProviders();
    expect(fetch.calls.filter((call) => call.url.includes('/auth/'))).toHaveLength(1);
  });

  it('refreshes shortly before the access token expires', async () => {
    const fetch = gatewayFetch(() => json([]));
    const { gateway, clock } = testGateway(fetch);
    await gateway.invoices.listProviders();
    clock.now += 1_739_000; // 1800 s lifetime, renewed 60 s early
    await gateway.invoices.listProviders();
    expect(fetch.calls).toHaveLength(3);
    clock.now += 2_000;
    await gateway.invoices.listProviders();
    expect(pathOf(fetch, 3)).toBe(REFRESH_PATH);
    expect(fetch.calls[3]?.headers.authorization).toBe('Bearer refresh-1');
    expect(fetch.calls[4]?.headers.authorization).toBe('Bearer access-2');
  });

  it('falls back to the app secret when the refresh token is rejected or expired', async () => {
    const fetch = fakeFetch((call) => {
      if (call.url.endsWith(REFRESH_PATH)) return json({ message: 'expired' }, 401);
      if (call.url.endsWith(TOKEN_PATH)) return json(tokenGrant(fetch.calls.length));
      return json([]);
    });
    const { gateway, clock } = testGateway(fetch);
    await gateway.invoices.listProviders();
    clock.now += 1_800_000;
    await gateway.invoices.listProviders();
    expect(fetch.calls.map((_, index) => pathOf(fetch, index))).toEqual([
      TOKEN_PATH,
      `${INVOICES_PATH}/payment-providers`,
      REFRESH_PATH,
      TOKEN_PATH,
      `${INVOICES_PATH}/payment-providers`,
    ]);
    clock.now += 10_000_000;
    await gateway.invoices.listProviders();
    expect(pathOf(fetch, 5)).toBe(TOKEN_PATH);
  });

  it('does not hide a refresh that fails for other reasons', async () => {
    const fetch = fakeFetch((call) =>
      call.url.endsWith(REFRESH_PATH) ? json({ message: 'down' }, 503) : json(tokenGrant()),
    );
    const { gateway, clock } = testGateway(fetch, { maxRetries: 0 });
    await gateway.invoices.listProviders().catch(() => undefined);
    clock.now += 1_800_000;
    await expect(gateway.invoices.listProviders()).rejects.toBeInstanceOf(BonumServerError);
  });

  it('uses a grant without a refresh token until it expires', async () => {
    const fetch = fakeFetch((call) =>
      call.url.includes('/auth/')
        ? json(tokenGrant(1, { refreshToken: null, expiresIn: 60 }))
        : json([]),
    );
    const { gateway, clock } = testGateway(fetch);
    await gateway.invoices.listProviders();
    clock.now += 29_000; // short-lived tokens are used for half their life
    await gateway.invoices.listProviders();
    clock.now += 2_000;
    await gateway.invoices.listProviders();
    expect(
      fetch.calls.map((_, index) => pathOf(fetch, index)).filter((p) => p === TOKEN_PATH),
    ).toHaveLength(2);
  });

  it('gets a new token once when Bonum rejects the current one, even for a POST', async () => {
    let invoiceCalls = 0;
    const fetch = gatewayFetch(() => {
      invoiceCalls += 1;
      return invoiceCalls === 1 ? json({ errorCode: 'NO_AUTH' }, 401) : json(invoiceBody);
    });
    const { gateway } = testGateway(fetch, { maxRetries: 0 });
    await expect(gateway.invoices.create(params)).resolves.toMatchObject(invoiceBody);
    // The refresh token is still valid, so it gets the new access token.
    expect(fetch.calls.map((call) => call.headers.authorization)).toEqual([
      `AppSecret ${APP_SECRET}`,
      'Bearer access-1',
      'Bearer refresh-1',
      'Bearer access-2',
    ]);
  });

  it('gives up after one renewal and explains which credentials to check', async () => {
    const fetch = gatewayFetch(() =>
      json({ errorCode: 'NO_AUTH', message: `\${invalid.token}` }, 401),
    );
    const { gateway } = testGateway(fetch);
    const error = await rejection(gateway.invoices.create(params));
    expect(error).toBeInstanceOf(BonumAuthenticationError);
    expect(error.message).toContain('BONUM_GATEWAY_APP_SECRET');
    expect(fetch.calls).toHaveLength(4);
  });

  it('reports a rejected app secret without sending the request', async () => {
    const fetch = fakeFetch(json({ errorCode: 'NO_AUTH' }, 401));
    const { gateway } = testGateway(fetch);
    const error = await rejection(gateway.invoices.create(params));
    expect(error).toBeInstanceOf(BonumAuthenticationError);
    expect(error.message).toContain('BONUM_GATEWAY_TERMINAL_ID');
    expect(fetch.calls).toHaveLength(1);
    expect(error.message).not.toContain(APP_SECRET);
  });

  it('renews only once when concurrent requests are rejected with the same old token', async () => {
    const fetch = gatewayFetch((call) =>
      call.headers.authorization === 'Bearer access-1'
        ? json({ errorCode: 'NO_AUTH' }, 401)
        : json(invoiceBody),
    );
    const { gateway } = testGateway(fetch, { maxRetries: 0 });
    await Promise.all([
      gateway.invoices.create(params),
      gateway.invoices.create({ ...params, transactionId: 'ORD-1002' }),
    ]);
    expect(fetch.calls.filter((call) => call.url.includes('/auth/'))).toHaveLength(2);
  });

  it('stops waiting for a token when the caller aborts', async () => {
    const fetch = hangingFetch();
    const { gateway } = testGateway(fetch);
    const controller = new AbortController();
    const pending = gateway.invoices.listProviders({ signal: controller.signal });
    const reason = new Error('caller gave up');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('keeps token endpoint bodies out of errors', async () => {
    const leaky = fakeFetch(json({ message: 'echo access-secret-xyz' }, 401));
    const error = await rejection(testGateway(leaky).gateway.invoices.listProviders());
    expect((error as BonumAuthenticationError).body).toBeNull();
    expect(error.message).not.toContain('access-secret-xyz');
    const garbled = fakeFetch(new Response('accessToken=access-secret-xyz', { status: 200 }));
    const parseError = await rejection(testGateway(garbled).gateway.invoices.listProviders());
    expect(parseError).toBeInstanceOf(BonumUnexpectedResponseError);
    expect((parseError as BonumUnexpectedResponseError).body).toBeUndefined();
    expect(parseError.cause).toBeUndefined();
  });

  it('retries a rate-limited token request', async () => {
    const fetch = fakeFetch(
      json({ message: 'Rate-Limit: Use previous token.' }, 429),
      json(tokenGrant()),
      json([]),
    );
    const { gateway } = testGateway(fetch);
    await expect(gateway.invoices.listProviders()).resolves.toEqual([]);
  });

  it.each([
    ['not an object', []],
    ['no access token', tokenGrant(1, { accessToken: '' })],
    ['a bad lifetime', tokenGrant(1, { expiresIn: 0 })],
    ['another unit', tokenGrant(1, { unit: 'MILLISECONDS' })],
  ])('rejects a token response with %s, without echoing it', async (_label, body) => {
    const fetch = fakeFetch(json(body));
    const { gateway } = testGateway(fetch);
    const error = await rejection(gateway.invoices.listProviders());
    expect(error).toBeInstanceOf(BonumUnexpectedResponseError);
    expect((error as BonumUnexpectedResponseError).body).toBeUndefined();
    expect(error.message).not.toContain('refresh-1');
  });
});

describe('invoices.create', () => {
  it('sends the invoice in Bonum field names and returns the checkout link', async () => {
    const fetch = gatewayFetch(() => json(invoiceBody));
    const { gateway } = testGateway(fetch);
    const invoice = await gateway.invoices.create({
      ...params,
      amount: 5000.5,
      callbackUrl: 'https://shop.example/orders/ORD-1001',
      providers: ['QPAY', 'E_COMMERCE', 'QPAY'],
      items: [
        { title: 'Coffee', amount: 5000.5, count: 1 },
        { title: 'Cup', amount: 0, count: 2, remark: 'gift', image: 'https://cdn.example/cup.png' },
      ],
      language: 'en',
    });
    expect(invoice).toEqual({ ...invoiceBody, transactionId: 'ORD-1001' });
    const call = fetch.calls[1];
    expect(call?.init.method).toBe('POST');
    expect(call?.headers['accept-language']).toBe('en');
    expect(call?.headers['content-type']).toBe('application/json');
    expect(call?.body).toEqual({
      amount: 5000.5,
      callback: 'https://shop.example/orders/ORD-1001',
      transactionId: 'ORD-1001',
      expiresIn: 900,
      providers: ['QPAY', 'E_COMMERCE'],
      items: [
        { title: 'Coffee', remark: '', amount: 5000.5, count: 1 },
        { title: 'Cup', remark: 'gift', amount: 0, count: 2, image: 'https://cdn.example/cup.png' },
      ],
    });
  });

  it('sends an empty callback and no optional fields by default', async () => {
    const fetch = gatewayFetch(() => json(invoiceBody));
    const { gateway } = testGateway(fetch);
    await gateway.invoices.create(params);
    expect(fetch.calls[1]?.body).toEqual({ ...params, callback: '' });
    expect(fetch.calls[1]?.headers).not.toHaveProperty('accept-language');
  });

  it('is never retried, because a repeated transactionId is rejected', async () => {
    const fetch = gatewayFetch(() => json({ message: 'boom' }, 503));
    const { gateway } = testGateway(fetch);
    await expect(gateway.invoices.create(params)).rejects.toBeInstanceOf(BonumServerError);
    expect(fetch.calls).toHaveLength(2);
  });

  it('explains a duplicate transactionId', async () => {
    const fetch = gatewayFetch(() =>
      json({ message: 'Transaction id is duplicated.', status: 409, traceId: 't-1' }, 409),
    );
    const { gateway } = testGateway(fetch);
    const error = await rejection(gateway.invoices.create(params));
    expect(error).toBeInstanceOf(BonumAPIError);
    expect((error as BonumAPIError).status).toBe(409);
    expect(error.message).toContain('Transaction id is duplicated');
    expect(error.message).toContain('every invoice needs a new one');
  });

  it('names the fields Bonum rejected', async () => {
    const body = {
      errorCode: 'INVALID_ARGS',
      message: 'invalid.arguments',
      data: { amount: 'jakarta.validation.constraints.Min.message', other: 5 },
    };
    const fetch = gatewayFetch(() => json(body, 400));
    const { gateway } = testGateway(fetch);
    const error = await rejection(gateway.invoices.create(params));
    expect(error).toBeInstanceOf(BonumBadRequestError);
    expect(error.message).toContain(
      'invalid.arguments (amount: jakarta.validation.constraints.Min.message)',
    );
  });

  it('says the invoice may exist after a timeout', async () => {
    const tokenFirst = hangingFetch();
    let first = true;
    const fetch = async (url: string, init: RequestInit) => {
      if (first) {
        first = false;
        return json(tokenGrant());
      }
      return tokenFirst(url, init);
    };
    const { gateway } = testGateway(fetch, { timeoutMs: 5 });
    const error = await rejection(gateway.invoices.create(params));
    expect(error).toBeInstanceOf(BonumTimeoutError);
    expect(error.message).toContain('its webhook will carry transactionId "ORD-1001"');
    expect(tokenFirst.calls).toBe(1);
  });

  it.each([
    ['invoiceId', { ...invoiceBody, invoiceId: '' }],
    ['followUpLink', { invoiceId: 'x' }],
    ['followUpLink', { ...invoiceBody, followUpLink: 'http://ecommerce.bonum.mn/x' }],
  ])('rejects a response with a bad %s', async (field, body) => {
    const fetch = gatewayFetch(() => json(body));
    const { gateway } = testGateway(fetch);
    const error = await rejection(gateway.invoices.create(params));
    expect(error).toBeInstanceOf(BonumUnexpectedResponseError);
    expect(error.message).toContain(field);
    expect(error.message).toContain('ORD-1001');
  });

  it.each([
    ['amount', { amount: 0 }],
    ['amount', { amount: 0.5 }],
    ['amount', { amount: 10.123 }],
    ['amount', { amount: Number.NaN }],
    ['amount', { amount: '5000' }],
    ['transactionId', { transactionId: '' }],
    ['transactionId', { transactionId: '   ' }],
    ['transactionId', { transactionId: 'x'.repeat(81) }],
    ['transactionId', { transactionId: 'ORD\n1' }],
    ['expiresIn', { expiresIn: 0 }],
    ['expiresIn', { expiresIn: 1.5 }],
    ['expiresIn', { expiresIn: undefined }],
    ['callbackUrl', { callbackUrl: 'not a url' }],
    ['callbackUrl', { callbackUrl: 'ftp://shop.example' }],
    ['providers', { providers: [] }],
    ['providers', { providers: ['qpay'] }],
    ['providers', { providers: 'QPAY' }],
    ['items', { items: {} }],
    ['items[0]', { items: [null] }],
    ['items[0].title', { items: [{ title: ' ', amount: 1, count: 1 }] }],
    ['items[0].count', { items: [{ title: 'A', amount: 1, count: 0 }] }],
    ['items[0].amount', { items: [{ title: 'A', amount: -1, count: 1 }] }],
    ['items[0].remark', { items: [{ title: 'A', amount: 1, count: 1, remark: 5 }] }],
    ['items[0].image', { items: [{ title: 'A', amount: 1, count: 1, image: 'http://x.example' }] }],
    ['language', { language: 'ru' }],
  ])('rejects an invalid %s before calling Bonum (%o)', async (field, override) => {
    const fetch = fakeFetch();
    const { gateway } = testGateway(fetch);
    const error = await rejection(gateway.invoices.create({ ...params, ...override } as never));
    expect(error).toMatchObject({ code: 'invalid_request', field });
    expect(fetch.calls).toHaveLength(0);
  });

  it('rejects params that are not an object', async () => {
    const { gateway } = testGateway(fakeFetch());
    await expect(gateway.invoices.create(null as never)).rejects.toMatchObject({ field: 'params' });
  });
});

describe('invoices.listProviders', () => {
  it('lists the payment methods and retries transient errors', async () => {
    let calls = 0;
    const fetch = gatewayFetch(() => {
      calls += 1;
      return calls === 1
        ? json({ message: 'busy' }, 503)
        : json([
            { provider: 'QPAY', enabled: true },
            { provider: 'SONO_SHOP', enabled: false },
            { provider: 'NEW_ONE' },
          ]);
    });
    const { gateway } = testGateway(fetch);
    await expect(gateway.invoices.listProviders()).resolves.toEqual([
      { provider: 'QPAY', enabled: true },
      { provider: 'SONO_SHOP', enabled: false },
      { provider: 'NEW_ONE', enabled: false },
    ]);
    expect(pathOf(fetch, 1)).toBe(`${INVOICES_PATH}/payment-providers`);
  });

  it.each([{ providers: [] }, [{ enabled: true }]])('rejects an unexpected shape', async (body) => {
    const { gateway } = testGateway(gatewayFetch(() => json(body)));
    await expect(gateway.invoices.listProviders()).rejects.toBeInstanceOf(
      BonumUnexpectedResponseError,
    );
  });
});
