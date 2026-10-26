import {
  BonumClient,
  type BonumClientOptions,
  BonumGatewayClient,
  type BonumGatewayClientOptions,
  type FetchFunction,
} from '../src/index.js';

/** Obviously fake credentials — never put a real key or secret in a test. */
export const MERCHANT_KEY = 'mk_test_example';
export const PAYMENT_ID = '3f0c5d2e-8b1a-4c6f-9e7d-2a1b0c9d8e7f';
export const ORDER_ID = 'ORD-1001';
export const SANDBOX = 'https://testpsp.bonum.mn';

export const submissionBody = {
  paymentId: PAYMENT_ID,
  orderId: ORDER_ID,
  status: 'PENDING',
  acceptedAt: '2026-10-26T04:00:00.000Z',
  statusUrl: `${SANDBOX}/api/v2/payments/${PAYMENT_ID}`,
  awaitUrl: `${SANDBOX}/api/v2/payments/${PAYMENT_ID}/await`,
};

export const paymentBody = {
  paymentId: PAYMENT_ID,
  orderId: ORDER_ID,
  amount: '150.50',
  currency: 'MNT',
  walletType: 'APPLE_PAY',
  status: 'AUTHORIZED',
  providerReference: 'BANK-REF-0001',
  failureReason: null,
  createdAt: '2026-10-26T04:00:00.000Z',
  updatedAt: '2026-10-26T04:00:02.000Z',
};

export const applePayToken = {
  paymentData: {
    data: 'ZmFrZS1lbmNyeXB0ZWQtZGF0YQ==',
    signature: 'ZmFrZS1zaWduYXR1cmU=',
    header: {
      publicKeyHash: 'ZmFrZS1oYXNo',
      ephemeralPublicKey: 'ZmFrZS1rZXk=',
      transactionId: 'fake0123456789abcdef',
    },
    version: 'EC_v1',
  },
  paymentMethod: { displayName: 'Visa 0000', network: 'Visa', type: 'debit' },
  transactionIdentifier: 'FAKE0123456789ABCDEF',
};

export const googlePayToken = JSON.stringify({
  signature: 'MEUCIQDfakesignature',
  intermediateSigningKey: { signedKey: '{"keyValue":"fake"}', signatures: ['MEYCIQfake'] },
  protocolVersion: 'ECv2',
  signedMessage: '{"encryptedMessage":"fake","ephemeralPublicKey":"fake","tag":"fake"}',
});

export interface RecordedCall {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = Response | Error | ((call: RecordedCall) => Response | Promise<Response>);

/** A fetch that answers with the queued replies in order and records every call. */
export function fakeFetch(...replies: Reply[]): FetchFunction & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const call: RecordedCall = {
      url,
      init,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = replies[Math.min(calls.length, replies.length) - 1];
    if (reply === undefined) throw new Error('fakeFetch: no reply queued');
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(call) : reply.clone();
  };
  return Object.assign(fetch, { calls });
}

/** The parsed JSON body of the n-th recorded call. */
export function sentBody(fetch: { calls: RecordedCall[] }, index = 0): Record<string, unknown> {
  const call = fetch.calls[index];
  if (call === undefined) throw new Error(`fakeFetch: no call #${index}`);
  return call.body as Record<string, unknown>;
}

/** A JSON response, 200 by default. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A fetch that never answers until its signal aborts, like a server that hangs. */
export function hangingFetch(): FetchFunction & { calls: number } {
  const state = { calls: 0 };
  const fetch = (_url: string, init: RequestInit): Promise<Response> => {
    state.calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  };
  return Object.defineProperty(fetch, 'calls', { get: () => state.calls }) as FetchFunction & {
    calls: number;
  };
}

/** A sandbox client with no real waiting between retries; `delays` records each backoff. */
export function testClient(
  fetch: FetchFunction,
  options: BonumClientOptions = {},
): { client: BonumClient; delays: number[] } {
  const delays: number[] = [];
  const client = new BonumClient({
    merchantKey: MERCHANT_KEY,
    environment: 'sandbox',
    fetch,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0.5,
    ...options,
  });
  return { client, delays };
}

/** Obviously fake webhook secrets. */
export const WEBHOOK_SECRET = 'test_webhook_secret';
export const ROTATED_SECRET = 'test_webhook_secret_rotated';
/** A fixed "now" for webhook tests, in Unix seconds. */
export const NOW_SECONDS = 1_793_000_000;

export const authorizedEvent = {
  webhookId: '9d2b7a4e-1c3f-4e5a-8b6d-0f1e2d3c4b5a',
  paymentId: PAYMENT_ID,
  orderId: ORDER_ID,
  eventType: 'AUTHORIZED',
  status: 'AUTHORIZED',
  amount: '150.50',
  currency: 'MNT',
  providerReference: 'BANK-REF-0001',
  failureReason: null,
  occurredAt: '2026-10-26T04:00:02.000Z',
  walletType: 'APPLE_PAY',
  binCategory: 'DOMESTIC',
};

/** Obviously fake gateway credentials. */
export const APP_SECRET = 'app_secret_test_example';
export const TERMINAL_ID = '00000001';
export const CHECKSUM_KEY = 'test_checksum_key';
export const GATEWAY = 'https://testapi.bonum.mn';
export const TOKEN_PATH = '/bonum-gateway/ecommerce/auth/create';
export const REFRESH_PATH = '/bonum-gateway/ecommerce/auth/refresh';
export const INVOICES_PATH = '/bonum-gateway/ecommerce/invoices';

/** A token grant like Bonum's, with distinguishable tokens. */
export function tokenGrant(
  n = 1,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tokenType: 'Bearer ',
    accessToken: `access-${n}`,
    expiresIn: 1800,
    refreshToken: `refresh-${n}`,
    refreshExpiresIn: 2000,
    unit: 'SECONDS',
    ...overrides,
  };
}

export const invoiceBody = {
  invoiceId: '8cf2c49d200f049f2b384f0adf42b981c141b6f269a137ea9616ea93e80c9d4d',
  followUpLink:
    'https://testecommerce.bonum.mn/ecommerce?invoiceId=c511ea63fbc08e8ea2ca6879b07bf764',
};

/** The path of the n-th recorded call. */
export function pathOf(fetch: { calls: RecordedCall[] }, index: number): string {
  const call = fetch.calls[index];
  if (call === undefined) throw new Error(`fakeFetch: no call #${index}`);
  return new URL(call.url).pathname;
}

/** A sandbox gateway client with fake credentials, no real waiting and a controllable clock. */
export function testGateway(
  fetch: FetchFunction,
  options: BonumGatewayClientOptions = {},
): { gateway: BonumGatewayClient; clock: { now: number } } {
  const clock = { now: 1_793_000_000_000 };
  const gateway = new BonumGatewayClient({
    appSecret: APP_SECRET,
    terminalId: TERMINAL_ID,
    environment: 'sandbox',
    fetch,
    sleep: async () => {},
    random: () => 0.5,
    now: () => clock.now,
    ...options,
  });
  return { gateway, clock };
}
