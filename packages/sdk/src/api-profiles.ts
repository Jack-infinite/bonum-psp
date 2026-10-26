import type { ErrorHints } from './api-errors.js';
import type { HttpProfile } from './http.js';

const PSP_HINTS: ErrorHints = {
  byStatus: new Map([
    [400, 'Check the request parameters against the Bonum V2 API reference.'],
    [
      401,
      'Check BONUM_MERCHANT_KEY and that the key belongs to this environment (sandbox keys only work on testpsp.bonum.mn).',
    ],
    [
      404,
      'The payment does not exist, belongs to another merchant or lives in the other environment.',
    ],
    [429, 'Bonum is rate limiting this merchant; slow down and try again later.'],
  ]),
  server: 'If it keeps happening, contact Bonum support with the paymentId.',
};

/** Hints for the Bonum Gateway (invoices). Its error bodies carry a `traceId` for support. */
export const GATEWAY_HINTS: ErrorHints = {
  byStatus: new Map([
    [400, 'Check the invoice parameters; the fields Bonum rejected are listed above.'],
    [
      401,
      'Check BONUM_GATEWAY_APP_SECRET and BONUM_GATEWAY_TERMINAL_ID, and that both belong to this ' +
        'environment (test credentials only work on testapi.bonum.mn).',
    ],
    [
      409,
      'This transactionId was already used: every invoice needs a new one. If an earlier attempt ' +
        'timed out, that invoice may exist; its webhook will carry this transactionId.',
    ],
    [429, 'Bonum is rate limiting this terminal; slow down and try again later.'],
  ]),
  server:
    'Bonum answers some invalid requests with 500 too (e.g. an unknown provider): check the ' +
    'parameters, then contact Bonum support with the traceId from error.body.',
};

/** The PSP V2 profile: a static `x-merchant-key` header, kept in this closure only. */
export function merchantKeyProfile(merchantKey: string): HttpProfile {
  const headers = Object.freeze({ 'x-merchant-key': merchantKey });
  return { headers: () => headers, hints: PSP_HINTS };
}
