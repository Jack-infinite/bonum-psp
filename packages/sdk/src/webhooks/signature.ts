import { BonumWebhookError } from '../errors.js';

const V1_DIGEST = /^[0-9a-f]{64}$/i;
const encoder = new TextEncoder();

/** The two signature headers, parsed. */
export interface SignatureHeaders {
  /** The timestamp exactly as sent: it is part of the signed message. */
  timestamp: string;
  /** The same timestamp in Unix seconds. */
  timestampSeconds: number;
  /** Every `v1` digest in the signature header, as bytes. */
  signatures: Uint8Array<ArrayBuffer>[];
}

/** Checks presence and format of `X-PSP-Signature` and `X-PSP-Timestamp`. */
export function parseSignatureHeaders(
  signature: string | undefined,
  timestamp: string | undefined,
): SignatureHeaders {
  if (signature === undefined || signature.trim() === '') {
    throw new BonumWebhookError(
      'missing_signature',
      'The X-PSP-Signature header is missing. Only Bonum can sign webhooks; check that no proxy strips it.',
    );
  }
  if (timestamp === undefined || timestamp.trim() === '') {
    throw new BonumWebhookError('missing_timestamp', 'The X-PSP-Timestamp header is missing.');
  }
  const value = timestamp.trim();
  const seconds = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(seconds)) {
    throw new BonumWebhookError(
      'invalid_timestamp',
      'X-PSP-Timestamp must be a Unix time in whole seconds.',
    );
  }
  return { timestamp: value, timestampSeconds: seconds, signatures: parseSignatures(signature) };
}

/** Rejects timestamps further than `toleranceSeconds` from now, in either direction (replays). */
export function assertFreshTimestamp(
  timestampSeconds: number,
  nowMs: number,
  toleranceSeconds: number,
): void {
  const ageSeconds = nowMs / 1000 - timestampSeconds;
  if (Math.abs(ageSeconds) <= toleranceSeconds) return;
  const direction = ageSeconds > 0 ? 'old' : 'in the future';
  throw new BonumWebhookError(
    'timestamp_out_of_tolerance',
    `X-PSP-Timestamp is ${Math.round(Math.abs(ageSeconds))} s ${direction}; at most ${toleranceSeconds} s ` +
      'is accepted. Check that your server clock is synced (NTP); otherwise this may be a replayed request.',
  );
}

/** The signed message: the UTF-8 bytes of `${timestamp}.` followed by the raw body bytes. */
export function signedMessage(timestamp: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = encoder.encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix, 0);
  message.set(body, prefix.length);
  return message;
}

/** Verifies HMAC-SHA256 signatures with Web Crypto against one or more secrets. */
export class SignatureVerifier {
  readonly #secrets: readonly string[];
  #keys: Promise<CryptoKey[]> | undefined;

  constructor(secrets: readonly string[]) {
    this.#secrets = secrets;
  }

  /** `true` when any signature matches any secret. */
  async verify(
    message: Uint8Array<ArrayBuffer>,
    signatures: readonly Uint8Array<ArrayBuffer>[],
  ): Promise<boolean> {
    for (const key of await this.#importKeys()) {
      for (const signature of signatures) {
        // subtle.verify compares in constant time; digests must never be compared with ===.
        if (await crypto.subtle.verify('HMAC', key, signature, message)) return true;
      }
    }
    return false;
  }

  // Imported once and cached; a failed import is retried on the next call.
  #importKeys(): Promise<CryptoKey[]> {
    this.#keys ??= Promise.all(
      this.#secrets.map((secret) =>
        crypto.subtle.importKey(
          'raw',
          encoder.encode(secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      ),
    ).catch((error: unknown) => {
      this.#keys = undefined;
      throw error;
    });
    return this.#keys;
  }
}

function parseSignatures(header: string): Uint8Array<ArrayBuffer>[] {
  const signatures: Uint8Array<ArrayBuffer>[] = [];
  for (const entry of header.split(',')) {
    const separator = entry.indexOf('=');
    const scheme = (separator === -1 ? entry : entry.slice(0, separator)).trim();
    if (scheme !== 'v1') continue;
    const digest = separator === -1 ? '' : entry.slice(separator + 1).trim();
    if (!V1_DIGEST.test(digest)) throw invalidSignatureFormat();
    signatures.push(hexToBytes(digest));
  }
  if (signatures.length === 0) throw invalidSignatureFormat();
  return signatures;
}

function invalidSignatureFormat(): BonumWebhookError {
  return new BonumWebhookError(
    'invalid_signature_format',
    'X-PSP-Signature must contain v1=<64 hex characters>.',
  );
}

/** Decodes an even-length hex string that was already checked against a pattern. */
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
