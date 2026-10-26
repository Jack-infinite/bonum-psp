import { afterEach, describe, expect, it } from 'vitest';
import {
  type BonumCall,
  connect,
  fakeBonum,
  json,
  MERCHANT_KEY,
  ORDER_ID,
  PAYMENT_ID,
  paymentBody,
  type TestClient,
  testDeps,
  textOf,
} from './helpers.js';

const UUID_PATH =
  /^\/api\/v2\/payments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let mcp: TestClient | undefined;

afterEach(async () => {
  await mcp?.close();
  mcp = undefined;
});

async function withBonum(
  reply: (call: BonumCall) => Response | Promise<Response>,
  env: Record<string, string | undefined> = {},
) {
  const bonum = fakeBonum(reply);
  mcp = await connect(testDeps(env, { fetch: bonum.fetch }));
  return { mcp, calls: bonum.calls };
}

describe('tool list', () => {
  it('describes all seven tools with schemas and accurate annotations', async () => {
    const { mcp } = await withBonum(() => json({}));
    const { tools } = await mcp.client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName).sort()).toEqual([
      'check_connection',
      'create_test_webhook',
      'get_payment',
      'get_payment_by_order_id',
      'send_test_webhook',
      'verify_webhook',
      'wait_for_payment_result',
    ]);
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.outputSchema, tool.name).toBeDefined();
      const properties = Object.values(tool.inputSchema.properties ?? {}) as {
        description?: string;
      }[];
      for (const property of properties) expect(property.description, tool.name).toBeTruthy();
    }
    expect(byName.check_connection?.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(byName.wait_for_payment_result?.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
    });
    expect(byName.verify_webhook?.annotations).toMatchObject({ openWorldHint: false });
    expect(byName.send_test_webhook?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('gives the client instructions that point to check_connection', async () => {
    const { mcp } = await withBonum(() => json({}));
    expect(mcp.client.getInstructions()).toContain('check_connection');
  });
});

describe('check_connection', () => {
  it('reports a working key when Bonum answers 404 for a random payment id', async () => {
    const { mcp, calls } = await withBonum(() =>
      json({ statusCode: 404, message: 'Not found' }, 404),
    );
    const result = await mcp.callTool('check_connection');
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      environment: 'sandbox',
      baseUrl: 'https://testpsp.bonum.mn',
      merchantKeyConfigured: true,
      webhookSecretConfigured: true,
      auth: 'ok',
      warnings: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toMatch(UUID_PATH);
    expect(calls[0]?.headers.get('x-merchant-key')).toBe(MERCHANT_KEY);
    expect(calls[0]?.headers.get('user-agent')).toMatch(/bonum-psp-mcp\//);
  });

  it.each([
    [
      'a rejected key',
      () => json({ message: 'Invalid or inactive request key' }, 401),
      'invalid_key',
    ],
    ['a network error', () => Promise.reject(new TypeError('fetch failed')), 'unreachable'],
    ['a server error', () => json({ message: 'boom' }, 500), 'error'],
    ['an unexpected success', () => json(paymentBody), 'ok'],
  ])('reports %s', async (_label, reply, auth) => {
    const { mcp } = await withBonum(reply);
    const result = await mcp.callTool('check_connection');
    expect(result.structuredContent).toMatchObject({ auth });
  });

  it('explains what is missing when nothing is configured', async () => {
    const { mcp, calls } = await withBonum(() => json({}), {
      BONUM_MERCHANT_KEY: undefined,
      BONUM_WEBHOOK_SECRET: undefined,
      BONUM_ENV: 'staging',
    });
    const result = await mcp.callTool('check_connection');
    expect(result.structuredContent).toMatchObject({
      merchantKeyConfigured: false,
      webhookSecretConfigured: false,
      auth: 'not_configured',
      warnings: ['BONUM_ENV must be "sandbox" or "production"; using sandbox.'],
    });
    expect(textOf(result)).toContain('BONUM_WEBHOOK_SECRET');
    expect(calls).toHaveLength(0);
  });
});

describe('get_payment', () => {
  it('returns the payment with its terminal state and normalized currency', async () => {
    const { mcp, calls } = await withBonum(() => json({ ...paymentBody, currency: '496' }));
    const result = await mcp.callTool('get_payment', { paymentId: PAYMENT_ID });
    expect(result.isError).toBeFalsy();
    expect(calls[0]?.url.pathname).toBe(`/api/v2/payments/${PAYMENT_ID}`);
    expect(result.structuredContent).toEqual({
      environment: 'sandbox',
      ...paymentBody,
      currency: '496',
      normalizedCurrency: 'MNT',
      isTerminal: true,
    });
    expect(textOf(result)).toContain('AUTHORIZED');
    expect(textOf(result)).toContain('MNT (Bonum sent "496")');
  });

  it('explains PENDING and FAILED', async () => {
    const { mcp } = await withBonum(() => json({ ...paymentBody, status: 'PENDING' }));
    const pending = await mcp.callTool('get_payment', { paymentId: PAYMENT_ID });
    expect(pending.structuredContent).toMatchObject({ status: 'PENDING', isTerminal: false });
    expect(textOf(pending)).toContain('not a failure');
    await mcp.close();
    const failed = await withBonum(() =>
      json({
        ...paymentBody,
        status: 'FAILED',
        providerReference: null,
        failureReason: 'Declined',
      }),
    );
    const result = await failed.mcp.callTool('get_payment', { paymentId: PAYMENT_ID });
    expect(textOf(result)).toContain('FAILED (Declined)');
  });

  it('turns Bonum errors into helpful isError results', async () => {
    const { mcp } = await withBonum(() =>
      json({ statusCode: 404, message: 'Payment not found' }, 404),
    );
    const result = await mcp.callTool('get_payment', { paymentId: PAYMENT_ID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('HTTP 404');
  });

  it('rejects an id that is not a UUID before calling Bonum', async () => {
    const { mcp, calls } = await withBonum(() => json(paymentBody));
    const result = await mcp.callTool('get_payment', { paymentId: 'ORD-1001' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('must be a UUID');
    expect(calls).toHaveLength(0);
  });

  it('explains how to configure the merchant key, with any configuration warnings', async () => {
    const { mcp } = await withBonum(() => json(paymentBody), {
      BONUM_MERCHANT_KEY: undefined,
      BONUM_ENV: 'staging',
    });
    const result = await mcp.callTool('get_payment', { paymentId: PAYMENT_ID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Set BONUM_MERCHANT_KEY');
    expect(textOf(result)).toContain('Configuration warnings: BONUM_ENV must be');
  });
});

describe('get_payment_by_order_id', () => {
  it('looks up by order id, encoding it in the query', async () => {
    const { mcp, calls } = await withBonum(() => json({ ...paymentBody, orderId: 'ORD 1/2&3' }));
    const result = await mcp.callTool('get_payment_by_order_id', { orderId: 'ORD 1/2&3' });
    expect(calls[0]?.url.pathname).toBe('/api/v2/payments/lookup/by-order-id');
    expect(calls[0]?.url.searchParams.get('orderId')).toBe('ORD 1/2&3');
    expect(result.structuredContent).toMatchObject({ orderId: 'ORD 1/2&3', status: 'AUTHORIZED' });
  });

  it('reports an array answer instead of guessing which attempt counts', async () => {
    const { mcp } = await withBonum(() => json([paymentBody, paymentBody]));
    const result = await mcp.callTool('get_payment_by_order_id', { orderId: ORDER_ID });
    expect(result.isError).toBe(true);
  });
});

describe('wait_for_payment_result', () => {
  it('waits 25 s by default and reports the outcome', async () => {
    const { mcp, calls } = await withBonum(() =>
      json({ paymentId: PAYMENT_ID, status: 'AUTHORIZED', failureReason: null }),
    );
    const result = await mcp.callTool('wait_for_payment_result', { paymentId: PAYMENT_ID });
    expect(calls[0]?.url.pathname).toBe(`/api/v2/payments/${PAYMENT_ID}/await`);
    expect(calls[0]?.url.searchParams.get('timeoutMs')).toBe('25000');
    expect(result.structuredContent).toEqual({
      environment: 'sandbox',
      paymentId: PAYMENT_ID,
      status: 'AUTHORIZED',
      isTerminal: true,
      failureReason: null,
      timedOut: false,
    });
  });

  it('says a timed-out wait is still pending, not failed', async () => {
    const { mcp, calls } = await withBonum(() =>
      json({ paymentId: PAYMENT_ID, status: 'PENDING', failureReason: null, timedOut: true }),
    );
    const result = await mcp.callTool('wait_for_payment_result', {
      paymentId: PAYMENT_ID,
      waitMs: 5_000,
    });
    expect(calls[0]?.url.searchParams.get('timeoutMs')).toBe('5000');
    expect(result.structuredContent).toMatchObject({ status: 'PENDING', timedOut: true });
    expect(textOf(result)).toContain('still PENDING after waiting 5 s');
  });

  it('rejects waits longer than Bonum allows', async () => {
    const { mcp, calls } = await withBonum(() => json({}));
    const result = await mcp.callTool('wait_for_payment_result', {
      paymentId: PAYMENT_ID,
      waitMs: 28_001,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('production', () => {
  it('labels every Bonum API result, including errors', async () => {
    const { mcp } = await withBonum(
      (call) =>
        call.url.pathname.endsWith(PAYMENT_ID)
          ? json(paymentBody)
          : json({ message: 'Payment not found' }, 404),
      { BONUM_ENV: 'production' },
    );
    const result = await mcp.callTool('get_payment', { paymentId: PAYMENT_ID });
    expect(result.structuredContent).toMatchObject({ environment: 'production' });
    expect(textOf(result)).toMatch(/^⚠️ PRODUCTION/);
    const error = await mcp.callTool('get_payment', { paymentId: crypto.randomUUID() });
    expect(error.isError).toBe(true);
    expect(textOf(error)).toMatch(/^⚠️ PRODUCTION/);
    const connection = await mcp.callTool('check_connection');
    expect(connection.structuredContent).toMatchObject({ environment: 'production', auth: 'ok' });
    expect(textOf(connection)).toMatch(/^⚠️ PRODUCTION/);
  });
});
