import { BonumConfigError, BonumWebhookError } from './errors.js';
import type { BonumWebhookEvent } from './webhooks/event.js';
import { assertCallbacks, rejectionResponse, report } from './webhooks/handler.js';
import { BonumWebhooks } from './webhooks/webhooks.js';

/**
 * The parts of an Express request the handler reads. Express 4 and 5 both fit; the SDK does not
 * depend on `express` or its types.
 *
 * @example
 * ```ts
 * const req: ExpressLikeRequest = { method: 'POST', body: Buffer.from('{}'), headers: {} };
 * ```
 */
export interface ExpressLikeRequest {
  method?: string | undefined;
  body?: unknown;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

/**
 * The parts of an Express response the handler uses.
 *
 * @example
 * ```ts
 * const send = (res: ExpressLikeResponse) => res.status(200).json({ received: true });
 * ```
 */
export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
}

/**
 * Express's `next` callback.
 *
 * @example
 * ```ts
 * const next: ExpressLikeNext = (error) => console.error(error);
 * ```
 */
export type ExpressLikeNext = (error?: unknown) => void;

/**
 * Options for {@link expressWebhookHandler}. Pass `webhooks` (e.g. `bonum.webhooks`) or `secret`.
 *
 * @example
 * ```ts
 * const options: ExpressWebhookHandlerOptions = { webhooks: bonum.webhooks, onEvent: saveEvent };
 * ```
 */
export interface ExpressWebhookHandlerOptions {
  /** A configured verifier, e.g. `bonum.webhooks`. */
  webhooks?: BonumWebhooks | undefined;
  /** Or the signing secret(s). Defaults to env `BONUM_WEBHOOK_SECRET` when `webhooks` is not given. */
  secret?: string | readonly string[] | undefined;
  /** Called once per verified event. Keep it fast; throwing makes the handler answer 500. */
  onEvent: (event: BonumWebhookEvent, context: { req: ExpressLikeRequest }) => unknown;
  /** Called for rejected webhooks and `onEvent` errors. Without it, errors go to `next(error)`. */
  onError?: ((error: unknown, context: { req: ExpressLikeRequest }) => unknown) | undefined;
}

const RAW_BODY_HINT =
  'The Bonum webhook route needs the raw body: register express.raw({ type: "application/json" }) on ' +
  'this route, before any global express.json(). A parsed body cannot be verified, because the ' +
  'signature covers the exact bytes Bonum sent.';

/**
 * Express middleware for Bonum webhooks, with the same answers as `webhooks.createHandler()`:
 * 405 for non-POST, 400 for rejected webhooks, 200 for unknown event types, 500 when `onEvent`
 * throws, 200 on success. A body that is not raw goes to `next()` as a `BonumConfigError` (500),
 * so Bonum keeps retrying until the fix is deployed.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { expressWebhookHandler } from 'bonum-psp/express';
 *
 * app.post(
 *   '/webhooks/bonum',
 *   express.raw({ type: 'application/json' }),
 *   expressWebhookHandler({ webhooks: bonum.webhooks, onEvent: (event) => saveEvent(event) }),
 * );
 * ```
 */
export function expressWebhookHandler(
  options: ExpressWebhookHandlerOptions,
): (req: ExpressLikeRequest, res: ExpressLikeResponse, next: ExpressLikeNext) => Promise<void> {
  assertCallbacks(options);
  const webhooks = options.webhooks ?? new BonumWebhooks({ secret: options.secret });
  const { onEvent, onError } = options;
  return async (req, res, next) => {
    if (req.method !== undefined && req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    if (typeof req.body !== 'string' && !(req.body instanceof Uint8Array)) {
      next(new BonumConfigError(RAW_BODY_HINT));
      return;
    }
    const context = { req };
    const fail = async (error: unknown): Promise<void> => {
      if (onError === undefined) return next(error);
      await report(onError, error, context);
      res.status(500).json({ error: 'internal_error' });
    };
    let event: BonumWebhookEvent;
    try {
      event = await webhooks.verify(req.body, req.headers);
    } catch (error) {
      if (!(error instanceof BonumWebhookError)) return fail(error);
      await report(onError, error, context);
      const { status, body } = rejectionResponse(error);
      res.status(status).json(body);
      return;
    }
    try {
      await onEvent(event, context);
    } catch (error) {
      return fail(error);
    }
    res.status(200).json({ received: true });
  };
}
