import { BonumConfigError, BonumWebhookError } from '../errors.js';
import { readEnv } from '../runtime.js';
import { parseJsonBody, rawBytes, readRequestBody } from '../webhooks/body.js';
import { getHeader, type WebhookHeaders } from '../webhooks/headers.js';
import { hexToBytes, SignatureVerifier } from '../webhooks/signature.js';
import type { WebhookPayload } from '../webhooks/webhooks.js';
import { type InvoicePaymentEvent, parseInvoicePaymentEvent } from './event.js';

const CHECKSUM_HEADER = 'x-checksum-v2';
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/i;
const encoder = new TextEncoder();

/**
 * Options for `new BonumGatewayWebhooks()`.
 *
 * @example
 * ```ts
 * const options: BonumGatewayWebhooksOptions = { checksumKey: process.env.BONUM_GATEWAY_CHECKSUM_KEY };
 * ```
 */
export interface BonumGatewayWebhooksOptions {
  /** Checksum key(s) from Bonum; several are allowed for rotation. Defaults to env `BONUM_GATEWAY_CHECKSUM_KEY`. */
  checksumKey?: string | readonly string[] | undefined;
}

/**
 * Verifies Bonum Gateway (invoice) webhooks by their `X-Checksum-V2` header. These webhooks carry
 * no timestamp, so a captured one can be replayed: make fulfilment idempotent per `transactionId`.
 *
 * @example
 * ```ts
 * import { BonumGatewayWebhooks } from 'bonum-psp';
 *
 * const webhooks = new BonumGatewayWebhooks({ checksumKey: process.env.BONUM_GATEWAY_CHECKSUM_KEY });
 * const event = await webhooks.verify(rawBody, req.headers);
 * ```
 */
export class BonumGatewayWebhooks {
  readonly #verifier: SignatureVerifier;

  constructor(options: BonumGatewayWebhooksOptions = {}) {
    if (typeof options !== 'object' || options === null) {
      throw new BonumConfigError('BonumGatewayWebhooks options must be an object.');
    }
    this.#verifier = new SignatureVerifier(resolveChecksumKeys(options.checksumKey));
  }

  /**
   * Verifies a webhook and returns the typed event. Throws `BonumWebhookError` when the request is
   * not a genuine Bonum webhook. Pass the raw body — never a parsed object.
   *
   * @example
   * ```ts
   * // Express: app.post('/webhooks/bonum-gateway', express.raw({ type: 'application/json' }), ...)
   * const event = await webhooks.verify(req.body, req.headers);
   * if (event.status === 'SUCCESS') await markPaid(event.transactionId, event.amount);
   * ```
   */
  async verify(payload: WebhookPayload, headers: WebhookHeaders): Promise<InvoicePaymentEvent> {
    const body = new Uint8Array(rawBytes(payload));
    const checksum = parseChecksum(getHeader(headers, CHECKSUM_HEADER));
    if (!(await this.#matches(body, checksum))) {
      throw new BonumWebhookError(
        'signature_mismatch',
        'The X-Checksum-V2 header does not match the body. Usual causes: the body was parsed before ' +
          'verification (use the raw bytes), or the checksum key is from the other environment.',
      );
    }
    return parseInvoicePaymentEvent(parseJsonBody(body));
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
  async verifyRequest(request: Request): Promise<InvoicePaymentEvent> {
    return this.verify(await readRequestBody(request), request.headers);
  }

  async #matches(
    body: Uint8Array<ArrayBuffer>,
    checksum: Uint8Array<ArrayBuffer>,
  ): Promise<boolean> {
    if (await this.#verifier.verify(body, [checksum])) return true;
    // Bonum's own sample computes the checksum over the body re-serialized without whitespace.
    // Accepting that form too keeps a pretty-printed delivery from failing; both are keyed MACs.
    const compact = compactJson(body);
    return compact !== undefined && (await this.#verifier.verify(compact, [checksum]));
  }
}

function parseChecksum(header: string | undefined): Uint8Array<ArrayBuffer> {
  if (header === undefined || header.trim() === '') {
    throw new BonumWebhookError(
      'missing_signature',
      'The X-Checksum-V2 header is missing. Only Bonum can sign webhooks; check that no proxy strips it.',
    );
  }
  const value = header.trim();
  if (!CHECKSUM_PATTERN.test(value)) {
    throw new BonumWebhookError(
      'invalid_signature_format',
      'X-Checksum-V2 must be 64 hex characters (an HMAC-SHA256 digest).',
    );
  }
  return hexToBytes(value);
}

function compactJson(body: Uint8Array): Uint8Array<ArrayBuffer> | undefined {
  try {
    return encoder.encode(JSON.stringify(JSON.parse(new TextDecoder().decode(body))));
  } catch {
    return undefined;
  }
}

function resolveChecksumKeys(value: unknown): string[] {
  const raw = value === undefined ? readEnv('BONUM_GATEWAY_CHECKSUM_KEY') : value;
  const list: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
  // Trimmed because secret stores and .env files often add a trailing newline.
  const keys = list.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (keys.length === 0 || keys.includes('')) {
    throw new BonumConfigError(
      'Missing Bonum Gateway checksum key. Pass `checksumKey` to new BonumGatewayWebhooks() (or to ' +
        'new BonumGatewayClient()), or set BONUM_GATEWAY_CHECKSUM_KEY. Bonum sends the key to ' +
        'merchants separately; keep it secret.',
    );
  }
  return keys;
}
