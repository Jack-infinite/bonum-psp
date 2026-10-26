import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BonumConfigError, BonumWebhooks } from '../src/index.js';
import { createTestWebhookEvent, signTestWebhook } from '../src/testing.js';
import { NOW_SECONDS, WEBHOOK_SECRET } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createTestWebhookEvent', () => {
  it('creates a consistent AUTHORIZED event with fresh ids by default', () => {
    const event = createTestWebhookEvent();
    expect(event).toMatchObject({
      eventType: 'AUTHORIZED',
      status: 'AUTHORIZED',
      failureReason: null,
    });
    expect(event.providerReference).toMatch(/^TEST-/);
    expect(event.webhookId).toMatch(UUID);
    expect(event.paymentId).toMatch(UUID);
    expect(createTestWebhookEvent().paymentId).not.toBe(event.paymentId);
  });

  it('creates a consistent FAILED event', () => {
    const event = createTestWebhookEvent({ eventType: 'FAILED' });
    expect(event).toMatchObject({ eventType: 'FAILED', status: 'FAILED', providerReference: null });
    expect(event.failureReason).toEqual(expect.any(String));
  });

  it('applies overrides but ignores undefined ones', () => {
    const event = createTestWebhookEvent({
      orderId: 'ORD-9',
      amount: '10.00',
      walletType: undefined,
    });
    expect(event).toMatchObject({ orderId: 'ORD-9', amount: '10.00', walletType: 'APPLE_PAY' });
  });
});

describe('signTestWebhook', () => {
  it('signs like Bonum does', async () => {
    const event = createTestWebhookEvent();
    const { body, headers } = await signTestWebhook({
      payload: event,
      secret: WEBHOOK_SECRET,
      timestamp: NOW_SECONDS,
    });
    const expected = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${NOW_SECONDS}.${body}`)
      .digest('hex');
    expect(body).toBe(JSON.stringify(event));
    expect(headers).toEqual({
      'content-type': 'application/json',
      'x-psp-signature': `v1=${expected}`,
      'x-psp-timestamp': String(NOW_SECONDS),
    });
  });

  it('round-trips through BonumWebhooks.verify', async () => {
    const event = createTestWebhookEvent({ eventType: 'FAILED' });
    const { body, headers } = await signTestWebhook({ payload: event, secret: WEBHOOK_SECRET });
    await expect(
      new BonumWebhooks({ secret: WEBHOOK_SECRET }).verify(body, headers),
    ).resolves.toEqual(event);
  });

  it('signs a raw string payload exactly as given and defaults the timestamp to now', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW_SECONDS * 1000 + 999 });
    try {
      const { body, headers } = await signTestWebhook({
        payload: ' {"a":1} ',
        secret: WEBHOOK_SECRET,
      });
      expect(body).toBe(' {"a":1} ');
      expect(headers['x-psp-timestamp']).toBe(String(NOW_SECONDS));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [{ secret: '' }, 'secret'],
    [{ secret: WEBHOOK_SECRET, timestamp: 1.5 }, 'timestamp'],
    [{ secret: WEBHOOK_SECRET, timestamp: -1 }, 'timestamp'],
  ])('rejects %o', async (input, message) => {
    const promise = signTestWebhook({ payload: '{}', ...input });
    await expect(promise).rejects.toThrow(BonumConfigError);
    await expect(signTestWebhook({ payload: '{}', ...input })).rejects.toThrow(message);
  });
});
