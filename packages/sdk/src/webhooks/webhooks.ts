import { BonumConfigError, BonumWebhookError } from '../errors.js';
import { readEnv } from '../runtime.js';
import { type BonumWebhookEvent, parseWebhookEvent } from './event.js';
import { createFetchHandler, type WebhookHandlerOptions } from './handler.js';
import { getHeader, type WebhookHeaders } from './headers.js';
import {
  assertFreshTimestamp,
  parseSignatureHeaders,
  SignatureVerifier,
  signedMessage,
} from './signature.js';

const DEFAULT_TOLERANCE_SECONDS = 300;
const MAX_TOLERANCE_SECONDS = 3_600;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * The raw webhook body: the exact bytes Bonum sent, or that text. Never a parsed object.
 *
 * @example
 * ```ts
 * const body: WebhookPayload = await request.text(); // or req.body from express.raw()
 * ```
 */
export type WebhookPayload = string | Uint8Array | ArrayBuffer;

/**
 * Options for `new BonumWebhooks()`.
 *
 * @example
 * ```ts
 * const options: BonumWebhooksOptions = { secret: [newSecret, oldSecret] }; // during rotation
 * ```
 */
export interface BonumWebhooksOptions {
  /** Signing secret(s) from Bonum. Several are allowed for rotation. Defaults to env `BONUM_WEBHOOK_SECRET`. */
  secret?: string | readonly string[] | undefined;
  /** Accepted clock difference in seconds, 1–3600. Default 300, as Bonum documents. */
  toleranceSeconds?: number | undefined;
  /** Testing hook: current time in milliseconds. Defaults to `Date.now`. */
  now?: (() => number) | undefined;
}

/**
 * Verifies Bonum webhooks: signature, timestamp and payload. Needs only the webhook secret, not
 * the merchant key.
 *
 * @example
 * ```ts
 * import { BonumWebhooks } from 'bonum-psp';
 *
 * const webhooks = new BonumWebhooks({ secret: process.env.BONUM_WEBHOOK_SECRET });
 * const event = await webhooks.verify(rawBody, req.headers);
 * ```
 */
export class BonumWebhooks {
  readonly #verifier: SignatureVerifier;
  readonly #toleranceSeconds: number;
  readonly #now: () => number;

  constructor(options: BonumWebhooksOptions = {}) {
    if (typeof options !== 'object' || options === null) {
      throw new BonumConfigError('BonumWebhooks options must be an object.');
    }
    this.#verifier = new SignatureVerifier(resolveSecrets(options.secret));
    this.#toleranceSeconds = resolveTolerance(options.toleranceSeconds);
    this.#now = resolveNow(options.now);
  }

  /**
   * Verifies a webhook and returns the typed event. Throws `BonumWebhookError` when the request is
   * not a genuine, fresh Bonum webhook. Pass the raw body — never a parsed object.
   *
   * @example
   * ```ts
   * // Express: app.post('/webhooks/bonum', express.raw({ type: 'application/json' }), ...)
   * const event = await webhooks.verify(req.body, req.headers);
   * ```
   */
  async verify(payload: WebhookPayload, headers: WebhookHeaders): Promise<BonumWebhookEvent> {
    const body = rawBytes(payload);
    const { timestamp, timestampSeconds, signatures } = parseSignatureHeaders(
      getHeader(headers, 'x-psp-signature'),
      getHeader(headers, 'x-psp-timestamp'),
    );
    assertFreshTimestamp(timestampSeconds, this.#now(), this.#toleranceSeconds);
    if (!(await this.#verifier.verify(signedMessage(timestamp, body), signatures))) {
      throw new BonumWebhookError(
        'signature_mismatch',
        'The webhook signature does not match. Usual causes: the body was parsed and re-serialized ' +
          'before verification (use the raw bytes), the secret is from the other environment, or a ' +
          'proxy rewrote the body.',
      );
    }
    return parseWebhookEvent(parseJson(body));
  }

  /**
   * Verifies a Fetch API `Request` (Next.js, Hono, Workers, Bun, Deno). Reads the body itself, so
   * call it before anything else reads the request.
   *
   * @example
   * ```ts
   * export async function POST(request: Request) {
   *   const event = await webhooks.verifyRequest(request);
   *   return Response.json({ received: true });
   * }
   * ```
   */
  async verifyRequest(request: Request): Promise<BonumWebhookEvent> {
    let body: ArrayBuffer;
    try {
      body = await request.arrayBuffer();
    } catch (error) {
      throw new BonumWebhookError(
        'body_not_raw',
        'Could not read the request body: something read it before verifyRequest() ran.',
        { cause: error },
      );
    }
    return this.verify(body, request.headers);
  }

  /**
   * Creates a Fetch API handler: 405 for non-POST, 400 for rejected webhooks, 200 for unknown
   * event types (so Bonum stops retrying), 500 when `onEvent` throws, 200 on success.
   *
   * @example
   * ```ts
   * // app/api/webhooks/bonum/route.ts (Next.js App Router)
   * export const POST = webhooks.createHandler({ onEvent: (event) => saveEvent(event) });
   * ```
   */
  createHandler(options: WebhookHandlerOptions): (request: Request) => Promise<Response> {
    return createFetchHandler((request) => this.verifyRequest(request), options);
  }
}

function rawBytes(payload: unknown): Uint8Array {
  if (typeof payload === 'string') return encoder.encode(payload);
  if (payload instanceof Uint8Array) return payload;
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  // toString check as well: an ArrayBuffer from another realm (vm, test runners) fails instanceof.
  if (
    payload instanceof ArrayBuffer ||
    Object.prototype.toString.call(payload) === '[object ArrayBuffer]'
  ) {
    return new Uint8Array(payload as ArrayBuffer);
  }
  throw new BonumWebhookError(
    'body_not_raw',
    `The webhook body must be the raw request body (string, Buffer/Uint8Array or ArrayBuffer), but got ${describe(payload)}. ` +
      'A JSON parser probably ran first. Express: use express.raw({ type: "application/json" }) on the ' +
      'webhook route, before any express.json(). Fetch API: pass await request.text() or use ' +
      'verifyRequest(request). Fastify: register a buffer content-type parser. NestJS: create the app ' +
      'with { rawBody: true } and pass req.rawBody.',
  );
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(body));
  } catch (error) {
    throw new BonumWebhookError(
      'invalid_payload',
      'The webhook body is not valid UTF-8 JSON, although its signature is valid.',
      { cause: error },
    );
  }
}

function resolveSecrets(secret: unknown): string[] {
  const value = secret === undefined ? readEnv('BONUM_WEBHOOK_SECRET') : secret;
  const list: readonly unknown[] = Array.isArray(value) ? value : [value];
  // Trimmed because secret stores and .env files often add a trailing newline.
  const secrets = list.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (secrets.length === 0 || secrets.includes('')) {
    throw new BonumConfigError(
      'Missing Bonum webhook signing secret. Pass `secret` to new BonumWebhooks() (or `webhookSecret` ' +
        'to new BonumClient()), or set BONUM_WEBHOOK_SECRET. Bonum issues the secret when it registers ' +
        'your webhook URL.',
    );
  }
  return secrets;
}

function resolveTolerance(value: unknown): number {
  if (value === undefined) return DEFAULT_TOLERANCE_SECONDS;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_TOLERANCE_SECONDS
  ) {
    throw new BonumConfigError(
      `toleranceSeconds must be an integer from 1 to ${MAX_TOLERANCE_SECONDS}.`,
    );
  }
  return value;
}

function resolveNow(value: (() => number) | undefined): () => number {
  if (value === undefined) return Date.now;
  if (typeof value !== 'function') throw new BonumConfigError('now must be a function.');
  return value;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object') return 'an object';
  return typeof value;
}
