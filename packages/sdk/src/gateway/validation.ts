import { BonumValidationError } from '../errors.js';
import { isPositiveInteger, isRecord, validateParams } from '../validation.js';
import type { InvoiceLanguage } from './params.js';

// Checked on the number's own decimal representation, so float arithmetic cannot hide a third digit.
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const PROVIDER_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MAX_TRANSACTION_ID = 80;

/** The validated create-invoice request. */
export interface InvoiceRequest {
  body: Record<string, unknown>;
  transactionId: string;
  language: InvoiceLanguage | undefined;
}

/** Validates `invoices.create()` params and builds the JSON body in Bonum's field names. */
export function validateCreateInvoice(params: unknown): InvoiceRequest {
  const fields = validateParams(params);
  const transactionId = validateTransactionId(fields.transactionId);
  const body: Record<string, unknown> = {
    amount: validateMoney(fields.amount, 'amount', 1),
    // Bonum requires the field; an empty string means "no redirect".
    callback: validateUrl(fields.callbackUrl, 'callbackUrl', ['https:', 'http:']) ?? '',
    transactionId,
    expiresIn: validateExpiresIn(fields.expiresIn),
  };
  if (fields.providers !== undefined) body.providers = validateProviders(fields.providers);
  if (fields.items !== undefined) body.items = validateItems(fields.items);
  return { body, transactionId, language: validateLanguage(fields.language) };
}

function validateTransactionId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > MAX_TRANSACTION_ID ||
    /\p{Cc}/u.test(value)
  ) {
    throw new BonumValidationError(
      `transactionId must be a non-blank string of 1–${MAX_TRANSACTION_ID} characters without ` +
        'control characters, unique for every invoice (e.g. your order id plus an attempt number).',
      'transactionId',
    );
  }
  return value;
}

function validateMoney(value: unknown, field: string, min: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    !AMOUNT_PATTERN.test(String(value))
  ) {
    throw new BonumValidationError(
      `${field} must be a number in major units (MNT), at least ${min}, with at most 2 decimal ` +
        `places (e.g. 5000); got ${String(value)}.`,
      field,
    );
  }
  return value;
}

function validateExpiresIn(value: unknown): number {
  if (!isPositiveInteger(value)) {
    throw new BonumValidationError(
      `expiresIn must be a whole number of seconds from 1 (e.g. 900 for 15 minutes); got ${String(value)}.`,
      'expiresIn',
    );
  }
  return value;
}

function validateUrl(value: unknown, field: string, protocols: string[]): string | undefined {
  if (value === undefined) return undefined;
  const url = typeof value === 'string' && URL.canParse(value) ? new URL(value) : undefined;
  if (url === undefined || !protocols.includes(url.protocol)) {
    throw new BonumValidationError(
      `${field} must be an absolute ${protocols.join(' or ')} URL.`,
      field,
    );
  }
  return value as string;
}

function validateProviders(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string' && PROVIDER_PATTERN.test(item))
  ) {
    throw new BonumValidationError(
      'providers must be a non-empty array of provider codes such as ["QPAY"]. ' +
        'gateway.invoices.listProviders() shows the ones enabled for your terminal.',
      'providers',
    );
  }
  return [...new Set(value as string[])];
}

function validateItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new BonumValidationError('items must be an array of { title, amount, count }.', 'items');
  }
  return value.map((item, index) => validateItem(item, `items[${index}]`));
}

function validateItem(item: unknown, field: string): Record<string, unknown> {
  if (!isRecord(item)) {
    throw new BonumValidationError(`${field} must be an object { title, amount, count }.`, field);
  }
  const { title, amount, count, remark = '', image } = item;
  if (typeof title !== 'string' || title.trim() === '') {
    throw new BonumValidationError(`${field}.title must be a non-blank string.`, `${field}.title`);
  }
  if (!isPositiveInteger(count)) {
    throw new BonumValidationError(
      `${field}.count must be a whole number from 1.`,
      `${field}.count`,
    );
  }
  if (typeof remark !== 'string') {
    throw new BonumValidationError(`${field}.remark must be a string.`, `${field}.remark`);
  }
  // Bonum requires `remark` (an empty string is fine) but not `image`.
  const line: Record<string, unknown> = {
    title,
    remark,
    amount: validateMoney(amount, `${field}.amount`, 0),
    count,
  };
  const imageUrl = validateUrl(image, `${field}.image`, ['https:']);
  if (imageUrl !== undefined) line.image = imageUrl;
  return line;
}

function validateLanguage(value: unknown): InvoiceLanguage | undefined {
  if (value === undefined || value === 'mn' || value === 'en') return value;
  throw new BonumValidationError("language must be 'mn' or 'en'.", 'language');
}
