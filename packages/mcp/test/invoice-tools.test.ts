import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_SECRET,
  type BonumCall,
  CHECKSUM_KEY,
  connect,
  fakeBonum,
  GATEWAY_ENV,
  json,
  NOW_MS,
  TERMINAL_ID,
  type TestClient,
  testDeps,
  textOf,
} from './helpers.js';

const INVOICES = '/bonum-gateway/ecommerce/invoices';
const invoiceBody = {
  invoiceId: '8cf2c49d200f049f2b384f0adf42b981c141b6f269a137ea9616ea93e80c9d4d',
  followUpLink:
    'https://testecommerce.bonum.mn/ecommerce?invoiceId=c511ea63fbc08e8ea2ca6879b07bf764',
};
const tokenBody = {
  tokenType: 'Bearer ',
  accessToken: 'access-token-1',
  expiresIn: 1800,
  refreshToken: 'refresh-token-1',
  refreshExpiresIn: 2000,
  unit: 'SECONDS',
};

let mcp: TestClient | undefined;

afterEach(async () => {
  await mcp?.close();
  mcp = undefined;
});

/** A fake gateway: token requests succeed, everything else gets `reply`. */
async function withGateway(
  reply: (call: BonumCall) => Response | Promise<Response>,
  env: Record<string, string | undefined> = GATEWAY_ENV,
) {
  const bonum = fakeBonum((call) =>
    call.url.pathname.includes('/auth/') ? json(tokenBody) : reply(call),
  );
  mcp = await connect(testDeps(env, { fetch: bonum.fetch, now: () => NOW_MS }));
  return { mcp, calls: bonum.calls };
}

function checksum(body: string): string {
  return createHmac('sha256', CHECKSUM_KEY).update(body, 'utf8').digest('hex');
}

describe('create_invoice', () => {
  it('creates an invoice and returns the checkout link', async () => {
    const { mcp, calls } = await withGateway(() => json(invoiceBody));
    const result = await mcp.callTool('create_invoice', {
      amount: 5000,
      transactionId: 'ORD-1001',
      providers: ['QPAY'],
      language: 'en',
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      environment: 'sandbox',
      ...invoiceBody,
      transactionId: 'ORD-1001',
      amount: 5000,
      expiresAt: new Date(NOW_MS + 3_600_000).toISOString(),
    });
    expect(textOf(result)).toContain(invoiceBody.followUpLink);
    expect(textOf(result)).toContain('only by webhook');
    expect(calls.map((call) => call.url.href)).toEqual([
      'https://testapi.bonum.mn/bonum-gateway/ecommerce/auth/create',
      `https://testapi.bonum.mn${INVOICES}`,
    ]);
    expect(calls[0]?.headers.get('x-terminal-id')).toBe(TERMINAL_ID);
    expect(calls[1]?.headers.get('authorization')).toBe('Bearer access-token-1');
    expect(calls[1]?.headers.get('accept-language')).toBe('en');
    expect(calls[1]?.headers.get('user-agent')).toMatch(/bonum-psp-mcp\//);
    expect(calls[1]?.body).toEqual({
      amount: 5000,
      callback: '',
      transactionId: 'ORD-1001',
      expiresIn: 3600,
      providers: ['QPAY'],
    });
  });

  it('generates a transactionId when none is given', async () => {
    const { mcp, calls } = await withGateway(() => json(invoiceBody));
    const result = await mcp.callTool('create_invoice', { amount: 5000, expiresIn: 600 });
    const sent = calls[1]?.body as { transactionId: string; expiresIn: number };
    expect(sent.transactionId).toMatch(/^mcp-\d{14}-[0-9a-f]{8}$/);
    expect(sent.expiresIn).toBe(600);
    expect(result.structuredContent).toMatchObject({ transactionId: sent.transactionId });
  });

  it('labels production invoices', async () => {
    const { mcp } = await withGateway(() => json(invoiceBody), {
      ...GATEWAY_ENV,
      BONUM_ENV: 'production',
    });
    const result = await mcp.callTool('create_invoice', { amount: 5000 });
    expect(textOf(result)).toMatch(/^⚠️ PRODUCTION/);
    expect(result.structuredContent).toMatchObject({ environment: 'production' });
  });

  it('passes on Bonum errors with what to do next', async () => {
    const { mcp } = await withGateway(() =>
      json({ message: 'Transaction id is duplicated.', status: 409 }, 409),
    );
    const result = await mcp.callTool('create_invoice', { amount: 5000, transactionId: 'X-1' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('every invoice needs a new one');
  });

  it('rejects invalid input before calling Bonum', async () => {
    const { mcp, calls } = await withGateway(() => json(invoiceBody));
    const result = await mcp.callTool('create_invoice', { amount: 10.123 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('at most 2 decimal places');
    expect(calls).toHaveLength(0);
  });

  it('explains how to configure the gateway', async () => {
    const { mcp, calls } = await withGateway(() => json(invoiceBody), {
      BONUM_GATEWAY_APP_SECRET: APP_SECRET,
    });
    const result = await mcp.callTool('create_invoice', { amount: 5000 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('BONUM_GATEWAY_TERMINAL_ID');
    expect(textOf(result)).toContain('BONUM_GATEWAY_TERMINAL_ID is not set');
    expect(calls).toHaveLength(0);
  });
});

describe('list_payment_providers', () => {
  it('lists enabled and disabled methods', async () => {
    const providers = [
      { provider: 'QPAY', enabled: true },
      { provider: 'E_COMMERCE', enabled: true },
      { provider: 'SONO_SHOP', enabled: false },
    ];
    const { mcp, calls } = await withGateway(() => json(providers));
    const result = await mcp.callTool('list_payment_providers');
    expect(result.structuredContent).toEqual({ environment: 'sandbox', providers });
    expect(textOf(result)).toBe('Enabled payment methods: QPAY, E_COMMERCE.\nDisabled: SONO_SHOP.');
    expect(calls[1]?.url.pathname).toBe(`${INVOICES}/payment-providers`);
  });

  it('says when nothing is enabled', async () => {
    const { mcp } = await withGateway(() => json([]));
    const result = await mcp.callTool('list_payment_providers');
    expect(textOf(result)).toBe('Enabled payment methods: none.');
  });
});

describe('verify_invoice_webhook', () => {
  const paid = JSON.stringify({
    type: 'PAYMENT',
    status: 'SUCCESS',
    message: '',
    body: { transactionId: 'ORD-1001', amount: 5000, currency: 'MNT', paymentVendor: 'QPAY' },
  });

  it('accepts a genuine webhook and summarizes it', async () => {
    const { mcp } = await withGateway(() => json({}));
    const result = await mcp.callTool('verify_invoice_webhook', {
      rawBody: paid,
      checksum: checksum(paid),
    });
    expect(result.structuredContent).toMatchObject({
      valid: true,
      event: { status: 'SUCCESS', transactionId: 'ORD-1001', amount: '5000' },
    });
    expect(textOf(result)).toContain('paid with QPAY, for transactionId ORD-1001, 5000 MNT');
  });

  it('summarizes a failed invoice', async () => {
    const expired = JSON.stringify({
      type: 'PAYMENT',
      status: 'FAILED',
      body: { transactionId: 'ORD-2', invoiceStatus: 'EXPIRED' },
    });
    const { mcp } = await withGateway(() => json({}));
    const result = await mcp.callTool('verify_invoice_webhook', {
      rawBody: expired,
      checksum: checksum(expired),
    });
    expect(textOf(result)).toContain('FAILED, failed (EXPIRED), for transactionId ORD-2.');
  });

  it.each([
    ['a wrong checksum', paid, '0'.repeat(64), 'signature_mismatch', ''],
    ['a card token webhook', '{"type":"CARD-TOKEN"}', '', 'unsupported_event_type', 'valid'],
  ])('explains %s', async (_label, rawBody, given, reason, note) => {
    const { mcp } = await withGateway(() => json({}));
    const result = await mcp.callTool('verify_invoice_webhook', {
      rawBody,
      checksum: given || checksum(rawBody),
    });
    expect(result.structuredContent).toMatchObject({ valid: false, reason });
    if (note) expect(textOf(result)).toContain('The checksum itself is valid.');
  });

  it('explains how to configure the checksum key', async () => {
    const { mcp } = await withGateway(() => json({}), {});
    const result = await mcp.callTool('verify_invoice_webhook', { rawBody: paid, checksum: 'x' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('BONUM_GATEWAY_CHECKSUM_KEY');
  });
});

describe('check_connection with gateway credentials', () => {
  it('reports working gateway credentials', async () => {
    const { mcp } = await withGateway((call) =>
      call.url.pathname.startsWith('/api/v2/')
        ? json({ message: 'Not found' }, 404)
        : json([{ provider: 'QPAY', enabled: true }]),
    );
    const result = await mcp.callTool('check_connection');
    expect(result.structuredContent).toMatchObject({
      auth: 'ok',
      gatewayConfigured: true,
      gatewayChecksumKeyConfigured: true,
      gatewayAuth: 'ok',
      gatewayAuthDetail: `Bonum Gateway at https://testapi.bonum.mn accepted terminal ${TERMINAL_ID}.`,
    });
    expect(textOf(result)).toContain('Gateway checksum key: set.');
  });

  it.each([
    [() => json({ errorCode: 'NO_AUTH' }, 401), 'invalid_key'],
    [() => Promise.reject(new TypeError('fetch failed')), 'unreachable'],
    [() => json({ message: 'boom' }, 500), 'error'],
  ])('reports gateway problems (%#)', async (reply, gatewayAuth) => {
    const bonum = fakeBonum(reply);
    mcp = await connect(testDeps(GATEWAY_ENV, { fetch: bonum.fetch }));
    const result = await mcp.callTool('check_connection');
    expect(result.structuredContent).toMatchObject({ gatewayAuth });
  });

  it('says when the invoice tools are off', async () => {
    const { mcp } = await withGateway(() => json({ message: 'Not found' }, 404), {});
    const result = await mcp.callTool('check_connection');
    expect(result.structuredContent).toMatchObject({
      gatewayConfigured: false,
      gatewayChecksumKeyConfigured: false,
      gatewayAuth: 'not_configured',
    });
    expect(textOf(result)).toContain('verify_invoice_webhook needs BONUM_GATEWAY_CHECKSUM_KEY');
  });
});
