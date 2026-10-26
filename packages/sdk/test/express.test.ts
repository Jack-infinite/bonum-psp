import { describe, expect, it, vi } from 'vitest';
import {
  type ExpressLikeRequest,
  type ExpressLikeResponse,
  expressWebhookHandler,
} from '../src/express.js';
import { BonumConfigError, BonumWebhookError, BonumWebhooks } from '../src/index.js';
import { signTestWebhook } from '../src/testing.js';
import { authorizedEvent, NOW_SECONDS, WEBHOOK_SECRET } from './helpers.js';

const now = () => NOW_SECONDS * 1000;
const webhooks = new BonumWebhooks({ secret: WEBHOOK_SECRET, now });

function fakeResponse() {
  const sent: { status?: number; body?: unknown; headers: Record<string, string> } = {
    headers: {},
  };
  const res: ExpressLikeResponse = {
    status(code) {
      sent.status = code;
      return res;
    },
    json(body) {
      sent.body = body;
      return res;
    },
    setHeader(name, value) {
      sent.headers[name] = value;
      return res;
    },
  };
  return { res, sent };
}

async function signedRequest(
  payload: Record<string, unknown> = authorizedEvent,
  options: { secret?: string; asString?: boolean } = {},
): Promise<ExpressLikeRequest> {
  const { body, headers } = await signTestWebhook({
    payload,
    secret: options.secret ?? WEBHOOK_SECRET,
    timestamp: NOW_SECONDS,
  });
  return { method: 'POST', body: options.asString ? body : Buffer.from(body), headers };
}

async function run(
  handler: ReturnType<typeof expressWebhookHandler>,
  req: ExpressLikeRequest,
): Promise<{ sent: ReturnType<typeof fakeResponse>['sent']; next: ReturnType<typeof vi.fn> }> {
  const { res, sent } = fakeResponse();
  const next = vi.fn();
  await handler(req, res, next);
  return { sent, next };
}

describe('expressWebhookHandler', () => {
  it('answers 200 for a verified Buffer or string body', async () => {
    const onEvent = vi.fn();
    const handler = expressWebhookHandler({ webhooks, onEvent });
    const req = await signedRequest();
    const { sent, next } = await run(handler, req);
    expect(sent).toMatchObject({ status: 200, body: { received: true } });
    expect(onEvent).toHaveBeenCalledWith(authorizedEvent, { req });
    expect(next).not.toHaveBeenCalled();
    expect(
      (await run(handler, await signedRequest(authorizedEvent, { asString: true }))).sent.status,
    ).toBe(200);
  });

  it('answers 405 to anything but POST', async () => {
    const { sent } = await run(expressWebhookHandler({ webhooks, onEvent: vi.fn() }), {
      method: 'GET',
      headers: {},
    });
    expect(sent).toEqual({
      status: 405,
      body: { error: 'method_not_allowed' },
      headers: { allow: 'POST' },
    });
  });

  it('sends a parsed body to next() as a BonumConfigError that names express.raw', async () => {
    const req = { ...(await signedRequest()), body: authorizedEvent };
    const { sent, next } = await run(expressWebhookHandler({ webhooks, onEvent: vi.fn() }), req);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(BonumConfigError);
    expect((error as Error).message).toContain('express.raw({ type: "application/json" })');
    expect(sent.status).toBeUndefined();
  });

  it('answers 400 for a bad signature and 200 for unknown event types', async () => {
    const onError = vi.fn();
    const handler = expressWebhookHandler({ webhooks, onEvent: vi.fn(), onError });
    const bad = await run(
      handler,
      await signedRequest(authorizedEvent, { secret: 'test_wrong_secret' }),
    );
    expect(bad.sent).toMatchObject({ status: 400, body: { error: 'signature_mismatch' } });
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(BonumWebhookError);
    const unknown = await run(
      handler,
      await signedRequest({ ...authorizedEvent, eventType: 'X', status: 'X' }),
    );
    expect(unknown.sent).toMatchObject({ status: 200, body: { received: true, ignored: true } });
  });

  it('answers 500 when onEvent throws and onError is set; otherwise calls next(error)', async () => {
    const failure = new Error('queue is down');
    const onError = vi.fn();
    const logged = await run(
      expressWebhookHandler({ webhooks, onEvent: () => Promise.reject(failure), onError }),
      await signedRequest(),
    );
    expect(logged.sent).toMatchObject({ status: 500, body: { error: 'internal_error' } });
    expect(onError).toHaveBeenCalledWith(failure, expect.anything());
    const passed = await run(
      expressWebhookHandler({ webhooks, onEvent: () => Promise.reject(failure) }),
      await signedRequest(),
    );
    expect(passed.next).toHaveBeenCalledWith(failure);
    expect(passed.sent.status).toBeUndefined();
  });

  it('passes unexpected verification errors on the same way', async () => {
    vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(new Error('crypto broke'));
    const { next } = await run(
      expressWebhookHandler({ webhooks, onEvent: vi.fn() }),
      await signedRequest(),
    );
    expect(next.mock.calls[0]?.[0]).toMatchObject({ message: 'crypto broke' });
  });

  it('builds its own verifier from `secret` or BONUM_WEBHOOK_SECRET', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW_SECONDS * 1000 });
    try {
      const fromSecret = expressWebhookHandler({ secret: WEBHOOK_SECRET, onEvent: vi.fn() });
      expect((await run(fromSecret, await signedRequest())).sent.status).toBe(200);
      vi.stubEnv('BONUM_WEBHOOK_SECRET', WEBHOOK_SECRET);
      const fromEnv = expressWebhookHandler({ onEvent: vi.fn() });
      expect(
        (await run(fromEnv, { ...(await signedRequest()), method: undefined })).sent.status,
      ).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails at setup without a secret or onEvent', () => {
    expect(() => expressWebhookHandler({ onEvent: vi.fn() })).toThrow('BONUM_WEBHOOK_SECRET');
    expect(() => expressWebhookHandler({ webhooks } as never)).toThrow('onEvent');
  });
});
