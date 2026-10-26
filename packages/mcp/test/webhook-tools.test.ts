import { execFileSync } from 'node:child_process';
import { createTestWebhookEvent, signTestWebhook } from 'bonum-psp/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { connect, NOW_MS, type TestClient, testDeps, textOf, WEBHOOK_SECRET } from './helpers.js';

const NOW_SECONDS = NOW_MS / 1000;

let mcp: TestClient | undefined;

afterEach(async () => {
  await mcp?.close();
  mcp = undefined;
});

async function open(env: Record<string, string | undefined> = {}): Promise<TestClient> {
  // No merchant key: the webhook tools must work without one.
  mcp = await connect(testDeps({ BONUM_MERCHANT_KEY: undefined, ...env }, { now: () => NOW_MS }));
  return mcp;
}

async function signed(payload: unknown = createTestWebhookEvent(), timestamp = NOW_SECONDS) {
  const { body, headers } = await signTestWebhook({
    payload: payload as Record<string, unknown>,
    secret: WEBHOOK_SECRET,
    timestamp,
  });
  return {
    rawBody: body,
    signature: headers['x-psp-signature'],
    timestamp: headers['x-psp-timestamp'],
  };
}

describe('verify_webhook', () => {
  it('accepts a genuine webhook and returns the event', async () => {
    const event = createTestWebhookEvent({ orderId: 'ORD-1001' });
    const result = await (await open()).callTool('verify_webhook', await signed(event));
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ valid: true, event });
    expect(textOf(result)).toContain('Valid Bonum webhook: AUTHORIZED for order ORD-1001');
  });

  it('explains a signature mismatch', async () => {
    const input = await signed();
    const result = await (await open()).callTool('verify_webhook', {
      ...input,
      rawBody: `${input.rawBody}\n`,
    });
    expect(result.structuredContent).toMatchObject({ valid: false, reason: 'signature_mismatch' });
    expect(textOf(result)).toContain('byte-exact');
  });

  it('rejects stale webhooks unless ignoreTimestamp replays them', async () => {
    const mcp = await open();
    const old = await signed(createTestWebhookEvent(), NOW_SECONDS - 3_600);
    const stale = await mcp.callTool('verify_webhook', old);
    expect(stale.structuredContent).toMatchObject({ reason: 'timestamp_out_of_tolerance' });
    const replay = await mcp.callTool('verify_webhook', { ...old, ignoreTimestamp: true });
    expect(replay.structuredContent).toMatchObject({ valid: true });
    expect(textOf(replay)).toContain('timestamp check skipped');
  });

  it('still rejects a malformed timestamp with ignoreTimestamp', async () => {
    const input = { ...(await signed()), timestamp: 'yesterday', ignoreTimestamp: true };
    const result = await (await open()).callTool('verify_webhook', input);
    expect(result.structuredContent).toMatchObject({ valid: false, reason: 'invalid_timestamp' });
  });

  it('says when the signature is fine but the event type is unknown', async () => {
    const input = await signed({ ...createTestWebhookEvent(), eventType: 'REFUNDED' });
    const result = await (await open()).callTool('verify_webhook', input);
    expect(result.structuredContent).toMatchObject({
      valid: false,
      reason: 'unsupported_event_type',
    });
    expect(textOf(result)).toContain('The signature itself is valid.');
  });

  it('explains how to configure the secret', async () => {
    const result = await (await open({ BONUM_WEBHOOK_SECRET: undefined })).callTool(
      'verify_webhook',
      await signed(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Set BONUM_WEBHOOK_SECRET');
  });
});

describe('create_test_webhook', () => {
  it('creates a signed AUTHORIZED webhook that verify_webhook accepts', async () => {
    const mcp = await open();
    const result = await mcp.callTool('create_test_webhook');
    const { body, headers, curl, expiresAt } = result.structuredContent as {
      body: string;
      headers: Record<string, string>;
      curl: string;
      expiresAt: string;
    };
    expect(JSON.parse(body)).toMatchObject({ eventType: 'AUTHORIZED', status: 'AUTHORIZED' });
    expect(headers['x-psp-timestamp']).toBe(String(NOW_SECONDS));
    expect(expiresAt).toBe(new Date(NOW_MS + 300_000).toISOString());
    expect(curl).toContain("curl -sS -i -X POST 'http://localhost:3000/webhooks/bonum'");
    expect(textOf(result)).toContain('accepted for 5 minutes');
    const verified = await mcp.callTool('verify_webhook', {
      rawBody: body,
      signature: headers['x-psp-signature'],
      timestamp: headers['x-psp-timestamp'],
    });
    expect(verified.structuredContent).toMatchObject({ valid: true });
  });

  it('applies the overrides', async () => {
    const result = await (await open()).callTool('create_test_webhook', {
      eventType: 'FAILED',
      orderId: 'ORD-7',
      amount: '99.90',
      currency: 'USD',
      walletType: 'GOOGLE_PAY',
      failureReason: 'Insufficient funds',
      url: 'https://shop.test/hooks/bonum',
    });
    const { body, curl } = result.structuredContent as { body: string; curl: string };
    expect(JSON.parse(body)).toMatchObject({
      eventType: 'FAILED',
      orderId: 'ORD-7',
      amount: '99.90',
      currency: 'USD',
      walletType: 'GOOGLE_PAY',
      failureReason: 'Insufficient funds',
      providerReference: null,
    });
    expect(curl).toContain("'https://shop.test/hooks/bonum'");
  });

  it('quotes the body so that a POSIX shell passes it through byte for byte', async () => {
    const result = await (await open()).callTool('create_test_webhook', {
      eventType: 'FAILED',
      failureReason: `Card's "limit" $HOME \`id\` \\ reached`,
    });
    const { body, curl } = result.structuredContent as { body: string; curl: string };
    const quoted = curl.slice(curl.indexOf('--data-raw ') + '--data-raw '.length);
    const echoed = execFileSync('/bin/sh', ['-c', `printf '%s' ${quoted}`], { encoding: 'utf8' });
    expect(echoed).toBe(body);
  });

  it('refuses to sign in production', async () => {
    const result = await (await open({ BONUM_ENV: 'production' })).callTool('create_test_webhook');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Refusing to sign test webhooks with BONUM_ENV=production');
  });

  it('explains how to configure the secret', async () => {
    const mcp = await open({ BONUM_WEBHOOK_SECRET: undefined });
    const result = await mcp.callTool('create_test_webhook');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('BONUM_WEBHOOK_SECRET');
  });

  it('rejects malformed overrides', async () => {
    const mcp = await open();
    for (const args of [{ amount: '1.234' }, { url: 'ftp://localhost/x' }, { paymentId: 'x' }]) {
      const result = await mcp.callTool('create_test_webhook', args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
  });
});
