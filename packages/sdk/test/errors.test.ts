import { describe, expect, it } from 'vitest';
import {
  BonumAPIError,
  BonumAuthenticationError,
  BonumBadRequestError,
  BonumConfigError,
  BonumConnectionError,
  BonumError,
  BonumNotFoundError,
  BonumRateLimitError,
  BonumServerError,
  BonumTimeoutError,
  BonumUnexpectedResponseError,
  BonumValidationError,
  BonumWebhookError,
  isBonumError,
} from '../src/index.js';

const init = {
  message: 'failed',
  status: 500,
  body: null,
  method: 'GET',
  path: '/api/v2/payments/x',
};

describe('errors', () => {
  it.each([
    [new BonumConfigError('x'), 'BonumConfigError', 'invalid_config'],
    [new BonumValidationError('x', 'amount'), 'BonumValidationError', 'invalid_request'],
    [new BonumConnectionError('x'), 'BonumConnectionError', 'connection_error'],
    [new BonumTimeoutError('x'), 'BonumTimeoutError', 'timeout'],
    [new BonumUnexpectedResponseError('x'), 'BonumUnexpectedResponseError', 'unexpected_response'],
    [new BonumAPIError(init), 'BonumAPIError', 'api_error'],
    [new BonumBadRequestError(init), 'BonumBadRequestError', 'api_error'],
    [new BonumAuthenticationError(init), 'BonumAuthenticationError', 'api_error'],
    [new BonumNotFoundError(init), 'BonumNotFoundError', 'api_error'],
    [new BonumRateLimitError(init), 'BonumRateLimitError', 'api_error'],
    [new BonumServerError(init), 'BonumServerError', 'api_error'],
    [new BonumWebhookError('signature_mismatch', 'x'), 'BonumWebhookError', 'webhook_error'],
  ])('%s has a stable name and code', (error, name, code) => {
    expect(error).toBeInstanceOf(BonumError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(isBonumError(error)).toBe(true);
    expect(String(error)).toBe(`${name}: ${error.message}`);
  });

  it('keeps the class hierarchy for API errors', () => {
    expect(new BonumNotFoundError(init)).toBeInstanceOf(BonumAPIError);
    expect(new BonumRateLimitError({ ...init, retryAfterMs: 5_000 }).retryAfterMs).toBe(5_000);
    expect(new BonumRateLimitError(init).retryAfterMs).toBeNull();
  });

  it('carries cause, field, reason and body', () => {
    const cause = new Error('socket closed');
    expect(new BonumConnectionError('x', { cause }).cause).toBe(cause);
    expect('cause' in new BonumConnectionError('x')).toBe(false);
    expect(new BonumValidationError('x', 'orderId').field).toBe('orderId');
    expect(new BonumWebhookError('body_not_raw', 'x').reason).toBe('body_not_raw');
    expect(new BonumUnexpectedResponseError('x', { body: { a: 1 } }).body).toEqual({ a: 1 });
  });

  it('isBonumError rejects everything else', () => {
    expect([new Error('x'), 'BonumError', null, { code: 'timeout' }].map(isBonumError)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
