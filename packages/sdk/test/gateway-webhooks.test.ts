import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BonumConfigError,
  BonumGatewayWebhooks,
  BonumWebhookError,
  type BonumWebhookErrorReason,
} from '../src/index.js';
import { createTestInvoiceWebhook, signTestGatewayWebhook } from '../src/testing.js';
import { CHECKSUM_KEY } from './helpers.js';

// Shaped like the samples in Bonum's gateway docs.
const paid = {
  type: 'PAYMENT',
  status: 'SUCCESS',
  message: '',
  body: {
    amount: 10000.0,
    currency: 'MNT',
    completedAt: '2026-01-29 11:20:33',
    terminalId: '17171994',
    invoiceId: '8eff7d69001c03f486f64410f9daa82c',
    paymentVendor: 'QPAY',
    initType: 'ECOMMERCE',
    status: 'PAID',
    respCode: '',
    transactionId: 'N998921',
    'extras-inputs': [],
    extras: [],
  },
};
const expired = {
  type: 'PAYMENT',
  status: 'FAILED',
  message: '',
  body: {
    transactionId: 'B347699',
    amount: 15000.0,
    currency: 'MNT',
    updatedAt: 1769657291559,
    terminalId: 17171994,
    invoiceStatus: 'EXPIRED',
  },
};

const webhooks = new BonumGatewayWebhooks({ checksumKey: CHECKSUM_KEY });

/** Independent signer: node:crypto, never the SDK's own code. */
function checksum(body: string, key = CHECKSUM_KEY): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('hex');
}

async function reason(promise: Promise<unknown>): Promise<BonumWebhookErrorReason> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BonumWebhookError);
    return (error as BonumWebhookError).reason;
  }
  throw new Error('expected a BonumWebhookError');
}

describe('BonumGatewayWebhooks.verify', () => {
  it('accepts a paid invoice webhook and types it', async () => {
    const body = JSON.stringify(paid);
    const event = await webhooks.verify(body, { 'X-Checksum-V2': checksum(body) });
    expect(event).toEqual({
      type: 'PAYMENT',
      status: 'SUCCESS',
      transactionId: 'N998921',
      invoiceId: '8eff7d69001c03f486f64410f9daa82c',
      amount: '10000',
      currency: 'MNT',
      paymentVendor: 'QPAY',
      invoiceStatus: 'PAID',
      completedAt: '2026-01-29 11:20:33',
      terminalId: '17171994',
      body: paid.body,
    });
  });

  it('accepts an expired invoice webhook', async () => {
    const body = JSON.stringify(expired);
    const event = await webhooks.verify(new TextEncoder().encode(body), {
      'x-checksum-v2': checksum(body).toUpperCase(),
    });
    expect(event).toMatchObject({
      status: 'FAILED',
      transactionId: 'B347699',
      invoiceId: null,
      amount: '15000',
      paymentVendor: null,
      invoiceStatus: 'EXPIRED',
      terminalId: '17171994',
    });
  });

  it('accepts a checksum over the compact form of a reformatted body', async () => {
    const compact = JSON.stringify(paid);
    const pretty = JSON.stringify(paid, null, 2);
    const event = await webhooks.verify(
      pretty,
      new Headers({ 'x-checksum-v2': checksum(compact) }),
    );
    expect(event.transactionId).toBe('N998921');
  });

  it('supports key rotation', async () => {
    const rotating = new BonumGatewayWebhooks({ checksumKey: ['new_key', CHECKSUM_KEY] });
    const body = JSON.stringify(paid);
    await expect(rotating.verify(body, { 'x-checksum-v2': checksum(body) })).resolves.toBeTruthy();
  });

  it.each([
    ['a missing header', {}, 'missing_signature'],
    ['a short digest', { 'x-checksum-v2': 'abc123' }, 'invalid_signature_format'],
    [
      'a wrong key',
      { 'x-checksum-v2': checksum(JSON.stringify(paid), 'other') },
      'signature_mismatch',
    ],
  ] as const)('rejects %s', async (_label, headers, expected) => {
    expect(await reason(webhooks.verify(JSON.stringify(paid), headers))).toBe(expected);
  });

  it('rejects a body that is not JSON when the checksum does not match', async () => {
    expect(await reason(webhooks.verify('not json', { 'x-checksum-v2': '0'.repeat(64) }))).toBe(
      'signature_mismatch',
    );
  });

  it('rejects a tampered body', async () => {
    const body = JSON.stringify(paid);
    const tampered = body.replace('10000', '1');
    expect(await reason(webhooks.verify(tampered, { 'x-checksum-v2': checksum(body) }))).toBe(
      'signature_mismatch',
    );
  });

  it('rejects a parsed body', async () => {
    expect(await reason(webhooks.verify(paid as never, { 'x-checksum-v2': '0'.repeat(64) }))).toBe(
      'body_not_raw',
    );
  });

  it.each([
    ['not JSON', 'not json', 'invalid_payload'],
    ['no type', JSON.stringify({ status: 'SUCCESS' }), 'invalid_payload'],
    [
      'a card token webhook',
      JSON.stringify({ type: 'CARD-TOKEN', status: 'SUCCESS' }),
      'unsupported_event_type',
    ],
    ['an unknown status', JSON.stringify({ ...paid, status: 'PENDING' }), 'invalid_payload'],
    ['no body', JSON.stringify({ type: 'PAYMENT', status: 'SUCCESS' }), 'invalid_payload'],
    ['no transactionId', JSON.stringify({ ...paid, body: { amount: 1 } }), 'invalid_payload'],
    [
      'an empty transactionId',
      JSON.stringify({ ...paid, body: { transactionId: '' } }),
      'invalid_payload',
    ],
  ])('reports a correctly signed body with %s', async (_label, body, expected) => {
    expect(await reason(webhooks.verify(body, { 'x-checksum-v2': checksum(body) }))).toBe(expected);
  });

  it('verifies a Fetch API request, and explains an already-read body', async () => {
    const body = JSON.stringify(paid);
    const request = () =>
      new Request('https://shop.example/webhooks/bonum-gateway', {
        method: 'POST',
        body,
        headers: { 'x-checksum-v2': checksum(body) },
      });
    await expect(webhooks.verifyRequest(request())).resolves.toMatchObject({ status: 'SUCCESS' });
    const used = request();
    await used.text();
    expect(await reason(webhooks.verifyRequest(used))).toBe('body_not_raw');
  });

  it('needs a checksum key', () => {
    expect(() => new BonumGatewayWebhooks()).toThrow('BONUM_GATEWAY_CHECKSUM_KEY');
    expect(() => new BonumGatewayWebhooks({ checksumKey: [] })).toThrow(BonumConfigError);
    expect(() => new BonumGatewayWebhooks(null as never)).toThrow(BonumConfigError);
  });
});

describe('gateway webhook test helpers', () => {
  it('signs like Bonum, so the verifier accepts it', async () => {
    const payload = createTestInvoiceWebhook({ transactionId: 'ORD-1001', amount: 5000 });
    const signed = await signTestGatewayWebhook({ payload, checksumKey: CHECKSUM_KEY });
    expect(signed.headers['x-checksum-v2']).toBe(checksum(signed.body));
    await expect(webhooks.verify(signed.body, signed.headers)).resolves.toMatchObject({
      status: 'SUCCESS',
      transactionId: 'ORD-1001',
      amount: '5000',
      paymentVendor: 'QPAY',
    });
  });

  it('builds an expired invoice and signs raw strings as is', async () => {
    const payload = createTestInvoiceWebhook({ status: 'FAILED' });
    const signed = await signTestGatewayWebhook({
      payload: JSON.stringify(payload),
      checksumKey: CHECKSUM_KEY,
    });
    await expect(webhooks.verify(signed.body, signed.headers)).resolves.toMatchObject({
      status: 'FAILED',
      invoiceStatus: 'EXPIRED',
    });
    await expect(signTestGatewayWebhook({ payload, checksumKey: '' })).rejects.toBeInstanceOf(
      BonumConfigError,
    );
  });
});
