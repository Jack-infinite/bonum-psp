import { createHmac } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  BonumClient,
  BonumConfigError,
  BonumWebhookError,
  type BonumWebhookErrorReason,
  BonumWebhooks,
} from '../src/index.js';
import {
  authorizedEvent,
  MERCHANT_KEY,
  NOW_SECONDS,
  ROTATED_SECRET,
  WEBHOOK_SECRET,
} from './helpers.js';

const now = (): number => NOW_SECONDS * 1000;
const rawBody = JSON.stringify(authorizedEvent);

// Independent of the SDK: expected signatures come from node:crypto.
function sign(
  body: string | Uint8Array,
  timestamp: number | string = NOW_SECONDS,
  secret = WEBHOOK_SECRET,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

function headersFor(
  body: string | Uint8Array,
  {
    timestamp = NOW_SECONDS,
    secret = WEBHOOK_SECRET,
  }: { timestamp?: number; secret?: string } = {},
): { 'x-psp-signature': string; 'x-psp-timestamp': string } {
  return {
    'x-psp-signature': `v1=${sign(body, timestamp, secret)}`,
    'x-psp-timestamp': String(timestamp),
  };
}

const webhooks = new BonumWebhooks({ secret: WEBHOOK_SECRET, now });

async function rejected(
  promise: Promise<unknown>,
  reason: BonumWebhookErrorReason,
): Promise<BonumWebhookError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BonumWebhookError);
  expect((error as BonumWebhookError).reason).toBe(reason);
  return error as BonumWebhookError;
}

describe('BonumWebhooks.verify', () => {
  it('returns the typed event for a valid webhook', async () => {
    await expect(webhooks.verify(rawBody, headersFor(rawBody))).resolves.toEqual(authorizedEvent);
  });

  it('accepts the body as string, Buffer, Uint8Array, ArrayBuffer or DataView', async () => {
    const bytes = new TextEncoder().encode(rawBody);
    const headers = headersFor(rawBody);
    for (const body of [
      rawBody,
      Buffer.from(rawBody),
      bytes,
      bytes.buffer,
      new DataView(bytes.buffer),
    ]) {
      await expect(webhooks.verify(body as Uint8Array, headers)).resolves.toMatchObject({
        eventType: 'AUTHORIZED',
      });
    }
  });

  it('verifies the exact bytes of non-ASCII bodies', async () => {
    const body = JSON.stringify({
      ...authorizedEvent,
      eventType: 'FAILED',
      status: 'FAILED',
      failureReason: 'Татгалзсан 🚫',
    });
    const bytes = Buffer.from(body, 'utf8');
    await expect(webhooks.verify(bytes, headersFor(bytes))).resolves.toMatchObject({
      failureReason: 'Татгалзсан 🚫',
    });
    await expect(webhooks.verify(body, headersFor(bytes))).resolves.toMatchObject({
      eventType: 'FAILED',
    });
  });

  it('rejects a tampered body and a wrong secret', async () => {
    const tampered = rawBody.replace('150.50', '1.50');
    await rejected(webhooks.verify(tampered, headersFor(rawBody)), 'signature_mismatch');
    const error = await rejected(
      webhooks.verify(rawBody, headersFor(rawBody, { secret: 'test_other_secret' })),
      'signature_mismatch',
    );
    expect(error.message).toContain('raw bytes');
  });

  it('accepts any of several secrets, for rotation', async () => {
    const rotating = new BonumWebhooks({ secret: [ROTATED_SECRET, WEBHOOK_SECRET], now });
    await expect(rotating.verify(rawBody, headersFor(rawBody))).resolves.toBeDefined();
    await expect(
      rotating.verify(rawBody, headersFor(rawBody, { secret: ROTATED_SECRET })),
    ).resolves.toBeDefined();
  });

  it('requires both headers', async () => {
    const { 'x-psp-signature': signature, 'x-psp-timestamp': timestamp } = headersFor(rawBody);
    await rejected(webhooks.verify(rawBody, { 'x-psp-timestamp': timestamp }), 'missing_signature');
    await rejected(webhooks.verify(rawBody, { 'x-psp-signature': signature }), 'missing_timestamp');
    await rejected(
      webhooks.verify(rawBody, { 'x-psp-signature': ' ', 'x-psp-timestamp': timestamp }),
      'missing_signature',
    );
    await rejected(
      webhooks.verify(rawBody, { 'x-psp-signature': signature, 'x-psp-timestamp': '' }),
      'missing_timestamp',
    );
    await rejected(webhooks.verify(rawBody, undefined as never), 'missing_signature');
  });

  it.each(['abc', '1.5', '-5', '1e9', '0x10', '99999999999999999999'])(
    'rejects timestamp %s',
    async (timestamp) => {
      const headers = {
        'x-psp-signature': `v1=${sign(rawBody, timestamp)}`,
        'x-psp-timestamp': timestamp,
      };
      await rejected(webhooks.verify(rawBody, headers), 'invalid_timestamp');
    },
  );

  it.each([
    [-300, true],
    [-301, false],
    [300, true],
    [301, false],
  ])('applies the 300 s tolerance in both directions (offset %i s)', async (offset, valid) => {
    const headers = headersFor(rawBody, { timestamp: NOW_SECONDS + offset });
    const result = webhooks.verify(rawBody, headers);
    if (valid) {
      await expect(result).resolves.toBeDefined();
    } else {
      const error = await rejected(result, 'timestamp_out_of_tolerance');
      expect(error.message).toContain(offset > 0 ? 'in the future' : 'old');
    }
  });

  it('honors a custom tolerance', async () => {
    const strict = new BonumWebhooks({ secret: WEBHOOK_SECRET, now, toleranceSeconds: 10 });
    await rejected(
      strict.verify(rawBody, headersFor(rawBody, { timestamp: NOW_SECONDS - 11 })),
      'timestamp_out_of_tolerance',
    );
  });

  it.each([
    ['no v1= prefix', () => sign(rawBody)],
    ['a short digest', () => 'v1=abc123'],
    ['a non-hex digest', () => `v1=${'g'.repeat(64)}`],
    ['an empty v1', () => 'v1='],
    ['only other schemes', () => `v2=${sign(rawBody)}`],
    ['a malformed second v1', () => `v1=${sign(rawBody)},v1=zz`],
  ])('rejects a signature header with %s', async (_label, header) => {
    const headers = { 'x-psp-signature': header(), 'x-psp-timestamp': String(NOW_SECONDS) };
    await rejected(webhooks.verify(rawBody, headers), 'invalid_signature_format');
  });

  it.each([
    ['a wrong and a right v1', () => `v1=${'0'.repeat(64)},v1=${sign(rawBody)}`],
    ['unknown schemes around v1', () => `t=${NOW_SECONDS}, v1=${sign(rawBody)} ,v0=legacy`],
    ['an upper-case digest', () => `v1=${sign(rawBody).toUpperCase()}`],
  ])('accepts a signature header with %s', async (_label, header) => {
    const headers = { 'x-psp-signature': header(), 'x-psp-timestamp': String(NOW_SECONDS) };
    await expect(webhooks.verify(rawBody, headers)).resolves.toBeDefined();
  });

  it('reads headers case-insensitively from objects, arrays and Headers', async () => {
    const { 'x-psp-signature': signature, 'x-psp-timestamp': timestamp } = headersFor(rawBody);
    const shapes = [
      { 'X-PSP-Signature': signature, 'X-Psp-Timestamp': timestamp },
      { 'x-psp-signature': [signature, 'v1=ignored'], 'x-psp-timestamp': [timestamp] },
      { 'x-psp-signature': [], 'X-PSP-SIGNATURE': signature, 'x-psp-timestamp': timestamp },
      new Headers({ 'X-PSP-Signature': signature, 'X-PSP-Timestamp': timestamp }),
    ];
    for (const headers of shapes)
      await expect(webhooks.verify(rawBody, headers)).resolves.toBeDefined();
  });

  it.each([
    ['a parsed object', authorizedEvent],
    ['null', null],
    ['a number', 42],
  ])('rejects %s as the body and names the fix', async (_label, body) => {
    const error = await rejected(
      webhooks.verify(body as never, headersFor(rawBody)),
      'body_not_raw',
    );
    expect(error.message).toContain('express.raw');
    expect(error.message).toContain('request.text()');
  });

  it('acknowledges unknown event types only after the signature passed', async () => {
    const body = JSON.stringify({ ...authorizedEvent, eventType: 'REFUNDED', status: 'REFUNDED' });
    const error = await rejected(webhooks.verify(body, headersFor(body)), 'unsupported_event_type');
    expect(error.message).toContain('"REFUNDED"');
    await rejected(webhooks.verify(body, headersFor(rawBody)), 'signature_mismatch');
  });

  it.each([
    ['invalid JSON', 'not json {'],
    ['invalid UTF-8', Buffer.from([0x7b, 0xff, 0x7d])],
    ['a JSON array', '[]'],
    ['a missing eventType', JSON.stringify({ ...authorizedEvent, eventType: undefined })],
    ['status different from eventType', JSON.stringify({ ...authorizedEvent, status: 'FAILED' })],
    ['a missing webhookId', JSON.stringify({ ...authorizedEvent, webhookId: undefined })],
    ['a numeric orderId', JSON.stringify({ ...authorizedEvent, orderId: 1001 })],
  ])('rejects a validly signed payload with %s', async (_label, body) => {
    await rejected(webhooks.verify(body, headersFor(body)), 'invalid_payload');
  });

  it('types FAILED events and defaults missing optional fields to null', async () => {
    const { walletType: _w, binCategory: _b, providerReference: _p, ...rest } = authorizedEvent;
    const body = JSON.stringify({
      ...rest,
      eventType: 'FAILED',
      status: 'FAILED',
      failureReason: 'Insufficient funds',
    });
    await expect(webhooks.verify(body, headersFor(body))).resolves.toEqual({
      ...rest,
      eventType: 'FAILED',
      status: 'FAILED',
      failureReason: 'Insufficient funds',
      providerReference: null,
      walletType: null,
      binCategory: null,
    });
  });

  it('imports each secret once and retries a failed import', async () => {
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    const fresh = new BonumWebhooks({ secret: WEBHOOK_SECRET, now });
    importKey.mockRejectedValueOnce(new Error('crypto unavailable'));
    await expect(fresh.verify(rawBody, headersFor(rawBody))).rejects.toThrow('crypto unavailable');
    await fresh.verify(rawBody, headersFor(rawBody));
    await fresh.verify(rawBody, headersFor(rawBody));
    expect(importKey).toHaveBeenCalledTimes(2);
  });
});

describe('BonumWebhooks.verifyRequest', () => {
  const request = (body: string, headers: Record<string, string>) =>
    new Request('https://shop.example/webhooks/bonum', { method: 'POST', body, headers });

  it('verifies a Fetch API request', async () => {
    await expect(webhooks.verifyRequest(request(rawBody, headersFor(rawBody)))).resolves.toEqual(
      authorizedEvent,
    );
  });

  it('reports a body that was already read', async () => {
    const consumed = request(rawBody, headersFor(rawBody));
    await consumed.text();
    await rejected(webhooks.verifyRequest(consumed), 'body_not_raw');
  });
});

describe('BonumWebhooks configuration', () => {
  it('reads and trims the secret from BONUM_WEBHOOK_SECRET', async () => {
    vi.stubEnv('BONUM_WEBHOOK_SECRET', `${WEBHOOK_SECRET}\n`);
    await expect(
      new BonumWebhooks({ now }).verify(rawBody, headersFor(rawBody)),
    ).resolves.toBeDefined();
    await expect(
      new BonumWebhooks({ secret: ` ${WEBHOOK_SECRET} `, now }).verify(
        rawBody,
        headersFor(rawBody),
      ),
    ).resolves.toBeDefined();
  });

  it.each([[undefined], [''], [[]], [[WEBHOOK_SECRET, ' ']], [42]])(
    'requires a secret (%o)',
    (secret) => {
      const create = () => new BonumWebhooks({ secret: secret as string });
      expect(create).toThrow(BonumConfigError);
      expect(create).toThrow('BONUM_WEBHOOK_SECRET');
    },
  );

  it.each([
    [{ toleranceSeconds: 0 }, 'toleranceSeconds'],
    [{ toleranceSeconds: 3601 }, 'toleranceSeconds'],
    [{ toleranceSeconds: 1.5 }, 'toleranceSeconds'],
    [{ now: 123 }, 'now must be a function'],
  ])('rejects %o', (option, message) => {
    expect(() => new BonumWebhooks({ secret: WEBHOOK_SECRET, ...option } as never)).toThrow(
      message,
    );
  });

  it('rejects options that are not an object', () => {
    expect(() => new BonumWebhooks(null as never)).toThrow('must be an object');
  });

  it('never exposes the secret', () => {
    const verifier = new BonumWebhooks({ secret: [WEBHOOK_SECRET, ROTATED_SECRET] });
    const views = [
      JSON.stringify(verifier),
      String(verifier),
      inspect(verifier, { showHidden: true, depth: Number.POSITIVE_INFINITY }),
    ];
    for (const view of views) {
      expect(view).not.toContain(WEBHOOK_SECRET);
    }
  });
});

describe('BonumClient.webhooks', () => {
  const base = { merchantKey: MERCHANT_KEY, environment: 'sandbox' } as const;

  it('is created lazily, so a client without a secret still works for payments', () => {
    const client = new BonumClient(base);
    expect(() => client.webhooks).toThrow(BonumConfigError);
  });

  it('uses the webhookSecret option or BONUM_WEBHOOK_SECRET and keeps one instance', () => {
    const client = new BonumClient({ ...base, webhookSecret: WEBHOOK_SECRET });
    expect(client.webhooks).toBeInstanceOf(BonumWebhooks);
    expect(client.webhooks).toBe(client.webhooks);
    vi.stubEnv('BONUM_WEBHOOK_SECRET', WEBHOOK_SECRET);
    expect(new BonumClient(base).webhooks).toBeInstanceOf(BonumWebhooks);
  });

  it('validates an explicit webhookSecret in the constructor', () => {
    expect(() => new BonumClient({ ...base, webhookSecret: '' })).toThrow(BonumConfigError);
  });

  it('keeps the webhook secret out of the client too', () => {
    const client = new BonumClient({ ...base, webhookSecret: WEBHOOK_SECRET });
    void client.webhooks;
    expect(inspect(client, { showHidden: true, depth: Number.POSITIVE_INFINITY })).not.toContain(
      WEBHOOK_SECRET,
    );
    expect(JSON.stringify(client)).not.toContain(WEBHOOK_SECRET);
  });
});
