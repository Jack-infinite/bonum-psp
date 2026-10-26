import { describe, expect, it, vi } from 'vitest';
import { BonumConfigError, BonumWebhookError, BonumWebhooks } from '../src/index.js';
import { signTestWebhook } from '../src/testing.js';
import { authorizedEvent, NOW_SECONDS, WEBHOOK_SECRET } from './helpers.js';

const webhooks = new BonumWebhooks({ secret: WEBHOOK_SECRET, now: () => NOW_SECONDS * 1000 });
const URL = 'https://shop.example/api/webhooks/bonum';

async function signedRequest(
  payload: Record<string, unknown> = authorizedEvent,
  secret = WEBHOOK_SECRET,
): Promise<Request> {
  const { body, headers } = await signTestWebhook({ payload, secret, timestamp: NOW_SECONDS });
  return new Request(URL, { method: 'POST', body, headers });
}

async function answer(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

describe('webhooks.createHandler', () => {
  it('answers 200 and passes the typed event and request to onEvent', async () => {
    const onEvent = vi.fn();
    const handler = webhooks.createHandler({ onEvent });
    const request = await signedRequest();
    expect(await answer(await handler(request))).toEqual({ status: 200, body: { received: true } });
    expect(onEvent).toHaveBeenCalledWith(authorizedEvent, { request });
  });

  it('answers 405 to anything but POST', async () => {
    const onEvent = vi.fn();
    const response = await webhooks.createHandler({ onEvent })(new Request(URL));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('answers 400 with only the reason for a bad signature, and reports it', async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const handler = webhooks.createHandler({ onEvent, onError });
    const result = await answer(
      await handler(await signedRequest(authorizedEvent, 'test_wrong_secret')),
    );
    expect(result).toEqual({ status: 400, body: { error: 'signature_mismatch' } });
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(BonumWebhookError);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('acknowledges unknown event types with 200 so Bonum stops retrying', async () => {
    const handler = webhooks.createHandler({ onEvent: vi.fn() });
    const request = await signedRequest({
      ...authorizedEvent,
      eventType: 'REFUNDED',
      status: 'REFUNDED',
    });
    expect(await answer(await handler(request))).toEqual({
      status: 200,
      body: { received: true, ignored: true },
    });
  });

  it('answers 500 when onEvent throws, so Bonum retries', async () => {
    const failure = new Error('database is down');
    const onError = vi.fn();
    const handler = webhooks.createHandler({ onEvent: () => Promise.reject(failure), onError });
    expect(await answer(await handler(await signedRequest()))).toEqual({
      status: 500,
      body: { error: 'internal_error' },
    });
    expect(onError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ request: expect.any(Request) }),
    );
  });

  it('rethrows onEvent errors to the framework when there is no onError', async () => {
    const failure = new Error('database is down');
    const handler = webhooks.createHandler({
      onEvent: () => {
        throw failure;
      },
    });
    await expect(handler(await signedRequest())).rejects.toBe(failure);
  });

  it('treats unexpected verification errors like onEvent errors', async () => {
    vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(new Error('crypto broke'));
    const onError = vi.fn();
    const withLogger = webhooks.createHandler({ onEvent: vi.fn(), onError });
    expect((await withLogger(await signedRequest())).status).toBe(500);
    const withoutLogger = webhooks.createHandler({ onEvent: vi.fn() });
    await expect(withoutLogger(await signedRequest())).rejects.toThrow('crypto broke');
  });

  it('keeps its answer when onError itself throws', async () => {
    const handler = webhooks.createHandler({
      onEvent: vi.fn(),
      onError: () => {
        throw new Error('logger down');
      },
    });
    const response = await handler(await signedRequest(authorizedEvent, 'test_wrong_secret'));
    expect(response.status).toBe(400);
  });

  it('checks the callbacks when the handler is created', () => {
    expect(() => webhooks.createHandler({} as never)).toThrow(BonumConfigError);
    expect(() => webhooks.createHandler(undefined as never)).toThrow('onEvent');
    expect(() => webhooks.createHandler({ onEvent: vi.fn(), onError: 'log' } as never)).toThrow(
      'onError',
    );
  });
});
