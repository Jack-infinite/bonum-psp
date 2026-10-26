import { BonumUnexpectedResponseError } from '../errors.js';
import { readFields } from '../fields.js';
import { REPORT, unexpected } from '../responses.js';
import { isRecord } from '../validation.js';
import type { Invoice, PaymentProviderStatus } from './types.js';

/** A token grant from `/auth/create` or `/auth/refresh`, with lifetimes in milliseconds. */
export interface TokenGrant {
  accessToken: string;
  expiresInMs: number;
  refreshToken: string | null;
  refreshExpiresInMs: number | null;
}

/** Checks a token response. Errors never carry the body: it holds the tokens. */
export function parseTokenGrant(data: unknown): TokenGrant {
  const fail = (problem: string): Error =>
    new BonumUnexpectedResponseError(`Unexpected token response from Bonum: ${problem}. ${REPORT}`);
  if (!isRecord(data)) throw fail('expected a JSON object');
  const { accessToken, expiresIn, refreshToken, refreshExpiresIn, unit } = data;
  if (unit !== undefined && unit !== null && unit !== 'SECONDS') {
    throw fail('"unit" should be "SECONDS"');
  }
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw fail('"accessToken" should be a non-empty string');
  }
  if (!isPositiveNumber(expiresIn)) throw fail('"expiresIn" should be a positive number');
  if (
    typeof refreshToken !== 'string' ||
    refreshToken === '' ||
    !isPositiveNumber(refreshExpiresIn)
  ) {
    // Without a usable refresh token the client simply requests a new token when this one expires.
    return {
      accessToken,
      expiresInMs: expiresIn * 1000,
      refreshToken: null,
      refreshExpiresInMs: null,
    };
  }
  return {
    accessToken,
    expiresInMs: expiresIn * 1000,
    refreshToken,
    refreshExpiresInMs: refreshExpiresIn * 1000,
  };
}

/** Checks the create-invoice response and adds the caller's `transactionId`. */
export function parseInvoice(data: unknown, transactionId: string): Invoice {
  const fail = unexpected(
    'invoice response',
    `The invoice may still have been created: its webhook will carry transactionId "${transactionId}".`,
    data,
  );
  const read = readFields(data, fail);
  const invoiceId = read.string('invoiceId');
  const followUpLink = read.string('followUpLink');
  if (invoiceId === '') throw fail('"invoiceId" is empty');
  if (!URL.canParse(followUpLink) || new URL(followUpLink).protocol !== 'https:') {
    throw fail('"followUpLink" should be an https: URL');
  }
  return { invoiceId, followUpLink, transactionId };
}

/** Checks the payment-providers list. */
export function parseProviders(data: unknown): PaymentProviderStatus[] {
  const fail = unexpected('payment providers list', 'Try again later.', data);
  if (!Array.isArray(data)) throw fail('expected a JSON array');
  return data.map((item: unknown) => {
    const read = readFields(item, fail);
    return { provider: read.string('provider'), enabled: read.flag('enabled') };
  });
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
