import { BonumError } from './errors.js';
import { isRecord } from './validation.js';

/**
 * Everything needed to build a {@link BonumAPIError}.
 *
 * @example
 * ```ts
 * const init: BonumAPIErrorInit = { message, status: 400, body, method: 'POST', path };
 * ```
 */
export interface BonumAPIErrorInit {
  message: string;
  status: number;
  body: unknown;
  method: string;
  path: string;
  retryAfterMs?: number | null | undefined;
}

/**
 * Bonum answered with an error status. Subclasses cover the common statuses.
 *
 * @example
 * ```ts
 * if (error instanceof BonumAPIError) console.error(error.status, error.method, error.path);
 * ```
 */
export class BonumAPIError extends BonumError {
  readonly code = 'api_error';
  override readonly name: string = 'BonumAPIError';
  /** HTTP status code. */
  readonly status: number;
  /** Parsed JSON error body, the truncated text body, or `null` when empty. */
  readonly body: unknown;
  /** HTTP method of the failed request. */
  readonly method: string;
  /** Path of the failed request, without the query string. */
  readonly path: string;

  constructor(init: BonumAPIErrorInit) {
    super(init.message);
    this.status = init.status;
    this.body = init.body;
    this.method = init.method;
    this.path = init.path;
  }
}

/**
 * HTTP 400: Bonum rejected a field. `body.message` lists the problems.
 *
 * @example
 * ```ts
 * if (error instanceof BonumBadRequestError) console.error(error.body);
 * ```
 */
export class BonumBadRequestError extends BonumAPIError {
  override readonly name: string = 'BonumBadRequestError';
}

/**
 * HTTP 401: the merchant key is missing, wrong, deactivated or from the other environment.
 *
 * @example
 * ```ts
 * if (error instanceof BonumAuthenticationError) alertOps('Check BONUM_MERCHANT_KEY');
 * ```
 */
export class BonumAuthenticationError extends BonumAPIError {
  override readonly name: string = 'BonumAuthenticationError';
}

/**
 * HTTP 404: no such payment for this merchant in this environment.
 *
 * @example
 * ```ts
 * if (error instanceof BonumNotFoundError) return null;
 * ```
 */
export class BonumNotFoundError extends BonumAPIError {
  override readonly name: string = 'BonumNotFoundError';
}

/**
 * HTTP 429: Bonum is rate limiting this merchant. Already retried.
 *
 * @example
 * ```ts
 * if (error instanceof BonumRateLimitError) await sleep(error.retryAfterMs ?? 5_000);
 * ```
 */
export class BonumRateLimitError extends BonumAPIError {
  override readonly name: string = 'BonumRateLimitError';
  /** Milliseconds Bonum asked us to wait (`Retry-After`), or `null` when it did not say. */
  readonly retryAfterMs: number | null;

  constructor(init: BonumAPIErrorInit) {
    super(init);
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

/**
 * HTTP 5xx: Bonum failed internally. Already retried where safe. Bonum support will ask for the
 * `paymentId`.
 *
 * @example
 * ```ts
 * if (error instanceof BonumServerError) console.error('Bonum is having trouble', error.status);
 * ```
 */
export class BonumServerError extends BonumAPIError {
  override readonly name: string = 'BonumServerError';
}

/** Next-step advice per API: by HTTP status, and for any 5xx. */
export interface ErrorHints {
  readonly byStatus: ReadonlyMap<number, string>;
  readonly server: string;
}

/** What the HTTP layer knows about a failed response. */
export type ApiErrorDetails = Omit<BonumAPIErrorInit, 'message'>;

/** Picks the error class for an HTTP status and writes a message that says what to do next. */
export function createApiError(details: ApiErrorDetails, hints: ErrorHints): BonumAPIError {
  const init: BonumAPIErrorInit = { ...details, message: apiErrorMessage(details, hints) };
  switch (details.status) {
    case 400:
      return new BonumBadRequestError(init);
    case 401:
      return new BonumAuthenticationError(init);
    case 404:
      return new BonumNotFoundError(init);
    case 429:
      return new BonumRateLimitError(init);
    default:
      return details.status >= 500 ? new BonumServerError(init) : new BonumAPIError(init);
  }
}

function apiErrorMessage(
  { status, body, method, path }: ApiErrorDetails,
  hints: ErrorHints,
): string {
  const detail = errorDetail(body).replace(/\.$/, '');
  const hint = hints.byStatus.get(status) ?? (status >= 500 ? hints.server : '');
  return [
    `Bonum returned HTTP ${status} for ${method} ${path}`,
    detail ? `: ${detail}.` : '.',
    hint ? ` ${hint}` : '',
  ].join('');
}

// PSP error bodies look like NestJS defaults, where validation errors put an array in `message`.
// Gateway bodies carry a generic `message` and name the rejected fields in a `data` object.
function errorDetail(body: unknown): string {
  if (typeof body === 'string') return body;
  if (!isRecord(body)) return '';
  const { message, error, data } = body;
  const fields = isRecord(data)
    ? Object.entries(data)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([field, problem]) => `${field}: ${problem}`)
    : [];
  const suffix = fields.length === 0 ? '' : ` (${fields.join('; ')})`;
  if (typeof message === 'string') return message + suffix;
  if (Array.isArray(message)) return message.filter((item) => typeof item === 'string').join('; ');
  return typeof error === 'string' ? error : '';
}
