import { BonumConfigError, BonumWebhookError } from '../errors.js';
import { isRecord } from '../validation.js';
import type { BonumWebhookEvent } from './event.js';

/**
 * Callbacks for `webhooks.createHandler()`.
 *
 * @example
 * ```ts
 * const options: WebhookHandlerOptions = {
 *   onEvent: async (event) => { await saveEvent(event); },
 *   onError: (error) => logger.warn({ error }, 'Bonum webhook rejected'),
 * };
 * ```
 */
export interface WebhookHandlerOptions {
  /**
   * Called once per verified event. Keep it fast (Bonum waits at most 10 s): store the event and
   * process it in the background. Throwing makes the handler answer 500, so Bonum retries.
   */
  onEvent: (event: BonumWebhookEvent, context: { request: Request }) => unknown;
  /**
   * Called for rejected webhooks and for errors thrown by `onEvent`. Without it, errors other than
   * verification failures are rethrown, so your framework logs them and answers 500.
   */
  onError?: ((error: unknown, context: { request: Request }) => unknown) | undefined;
}

/** The answer a webhook endpoint gives when verification fails with a `BonumWebhookError`. */
export interface RejectionResponse {
  status: number;
  body: { error: string } | { received: true; ignored: true };
}

/**
 * Bad signatures and payloads get 400 without details that would help an attacker. An event type
 * the SDK does not know is acknowledged with 200, or Bonum would retry it until it gives up.
 */
export function rejectionResponse(error: BonumWebhookError): RejectionResponse {
  return error.reason === 'unsupported_event_type'
    ? { status: 200, body: { received: true, ignored: true } }
    : { status: 400, body: { error: error.reason } };
}

/** Calls `onError` without letting a failing logger change the answer Bonum gets. */
export async function report<C>(
  onError: ((error: unknown, context: C) => unknown) | undefined,
  error: unknown,
  context: C,
): Promise<void> {
  try {
    await onError?.(error, context);
  } catch {
    // Ignored on purpose: the webhook response must not depend on the logger.
  }
}

/** Checks the callbacks once, when the handler is created. */
export function assertCallbacks(options: unknown): void {
  const { onEvent, onError } = isRecord(options) ? options : {};
  if (typeof onEvent !== 'function') {
    throw new BonumConfigError('The webhook handler needs an `onEvent(event)` function.');
  }
  if (onError !== undefined && typeof onError !== 'function') {
    throw new BonumConfigError('`onError` must be a function.');
  }
}

/** Builds the Fetch API handler behind `webhooks.createHandler()`. */
export function createFetchHandler(
  verifyRequest: (request: Request) => Promise<BonumWebhookEvent>,
  options: WebhookHandlerOptions,
): (request: Request) => Promise<Response> {
  assertCallbacks(options);
  const { onEvent, onError } = options;
  return async (request) => {
    if (request.method !== 'POST') {
      return Response.json(
        { error: 'method_not_allowed' },
        { status: 405, headers: { allow: 'POST' } },
      );
    }
    const context = { request };
    const fail = async (error: unknown): Promise<Response> => {
      if (onError === undefined) throw error;
      await report(onError, error, context);
      return Response.json({ error: 'internal_error' }, { status: 500 });
    };
    let event: BonumWebhookEvent;
    try {
      event = await verifyRequest(request);
    } catch (error) {
      if (!(error instanceof BonumWebhookError)) return fail(error);
      await report(onError, error, context);
      const { status, body } = rejectionResponse(error);
      return Response.json(body, { status });
    }
    try {
      await onEvent(event, context);
    } catch (error) {
      return fail(error);
    }
    return Response.json({ received: true });
  };
}
