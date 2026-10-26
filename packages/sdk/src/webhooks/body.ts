import { BonumWebhookError } from '../errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** The raw body as bytes; anything else means a JSON parser ran first. */
export function rawBytes(payload: unknown): Uint8Array {
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

/** Parses a verified body; it must be UTF-8 JSON. */
export function parseJsonBody(body: Uint8Array): unknown {
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

/** Reads a Fetch API request's body as bytes. */
export async function readRequestBody(request: Request): Promise<ArrayBuffer> {
  try {
    return await request.arrayBuffer();
  } catch (error) {
    throw new BonumWebhookError(
      'body_not_raw',
      'Could not read the request body: something read it before verifyRequest() ran.',
      { cause: error },
    );
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object') return 'an object';
  return typeof value;
}
