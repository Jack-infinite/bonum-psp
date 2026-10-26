import { createApiError, type ErrorHints } from './api-errors.js';
import { BonumConnectionError, BonumTimeoutError, BonumUnexpectedResponseError } from './errors.js';
import { isRetryableStatus, parseRetryAfterMs, retryDelayMs } from './retry.js';
import type { ResolvedTransport } from './transport.js';

const MAX_BODY_EXCERPT = 500;

/** One API call, as a resource describes it. */
export interface HttpRequest<T> {
  method: 'GET' | 'POST';
  /** Path below the base URL; dynamic segments must already be validated and encoded. */
  path: string;
  /** Query parameters; every key and value is percent-encoded here. */
  query?: Readonly<Record<string, string>> | undefined;
  /** JSON body (POST only). */
  body?: unknown;
  /** Extra headers for this request; they override the profile's. */
  headers?: Readonly<Record<string, string>> | undefined;
  /** Checks the 2xx JSON body; throws `BonumUnexpectedResponseError` on a mismatch. */
  parse: (data: unknown) => T;
  /** Whether network errors, timeouts, 429 and 5xx may be retried. */
  retry: boolean;
  /** Timeout per attempt; defaults to the client's `timeoutMs`. */
  timeoutMs?: number | undefined;
  /** The caller's signal. Its abort reason is rethrown unchanged. */
  signal?: AbortSignal | undefined;
  /** What a timeout means for this request; defaults to the generic advice. */
  timeoutAdvice?: string | undefined;
  /** Keeps response bodies out of errors, for responses that may contain credentials. */
  hideBody?: boolean | undefined;
}

/** How one Bonum API authenticates and explains its errors. */
export interface HttpProfile {
  /** Headers that authenticate one attempt. A promise when a token must be fetched first. */
  headers(): Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
  /**
   * Drops the credentials in `rejected` (the headers Bonum refused) after a 401. Returning `true`
   * repeats the request once with fresh ones; a 401 means Bonum did not act on the request, so
   * even a POST is safe to repeat.
   */
  renew?: ((rejected: Readonly<Record<string, string>>) => boolean) | undefined;
  /** Next-step advice in error messages. */
  hints: ErrorHints;
}

type Attempt<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: Error;
      retryable: boolean;
      retryAfterMs: number | null;
      status: number | null;
      auth: Readonly<Record<string, string>>;
    };

/** Sends requests to Bonum: auth headers, timeouts, retries and error mapping. */
export class HttpClient {
  readonly #config: ResolvedTransport;
  readonly #profile: HttpProfile;

  constructor(config: ResolvedTransport, profile: HttpProfile) {
    this.#config = config;
    this.#profile = profile;
  }

  /** Sends the request, retrying when allowed, and returns the parsed body. */
  async request<T>(request: HttpRequest<T>): Promise<T> {
    const maxRetries = request.retry ? this.#config.maxRetries : 0;
    let renewed = false;
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.#attempt(request);
      if (result.ok) return result.value;
      if (result.status === 401 && !renewed && this.#profile.renew?.(result.auth) === true) {
        // Not counted as a retry: the credentials changed, not the odds.
        renewed = true;
        attempt -= 1;
        continue;
      }
      if (!result.retryable || attempt >= maxRetries) throw result.error;
      await this.#config.sleep(
        retryDelayMs(attempt, result.retryAfterMs, this.#config.random),
        request.signal,
      );
    }
  }

  async #attempt<T>(request: HttpRequest<T>): Promise<Attempt<T>> {
    request.signal?.throwIfAborted();
    // Before the timeout starts, and outside the try: a token request has its own timeout and
    // throws its own, more precise error. Static headers are not awaited, so fetch starts at once.
    const pending = this.#profile.headers();
    const auth = pending instanceof Promise ? await untilAborted(pending, request.signal) : pending;
    request.signal?.throwIfAborted();
    const timeoutMs = request.timeoutMs ?? this.#config.timeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal =
      request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
    const fetch = this.#config.fetch;
    const init = this.#init(request, signal, auth);
    let response: Response;
    let text: string;
    try {
      response = await fetch(this.#url(request), init);
      text = await response.text();
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      const failure = timeout.aborted
        ? new BonumTimeoutError(timeoutMessage(request, timeoutMs))
        : new BonumConnectionError(
            `Could not reach Bonum at ${this.#config.baseUrl} (${request.method} ${request.path}): ` +
              `${describeError(error)}. Check the network, DNS and baseUrl.`,
            { cause: error },
          );
      return { ok: false, error: failure, retryable: true, retryAfterMs: null, status: null, auth };
    }
    return handleResponse(request, response, text, this.#profile.hints, auth);
  }

  #url(request: HttpRequest<unknown>): string {
    const query = Object.entries(request.query ?? {})
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return `${this.#config.baseUrl}${request.path}${query === '' ? '' : `?${query}`}`;
  }

  #init(
    request: HttpRequest<unknown>,
    signal: AbortSignal,
    auth: Readonly<Record<string, string>>,
  ): RequestInit {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.#config.userAgent,
      ...auth,
      ...request.headers,
    };
    if (request.method === 'POST') headers['content-type'] = 'application/json';
    // 'manual' rather than 'error': Cloudflare Workers rejects 'error'. Redirects fail below either way,
    // so credentials are never sent to another host.
    const init: RequestInit = { method: request.method, headers, signal, redirect: 'manual' };
    if (request.body !== undefined) init.body = JSON.stringify(request.body);
    return init;
  }
}

function handleResponse<T>(
  request: HttpRequest<T>,
  response: Response,
  text: string,
  hints: ErrorHints,
  auth: Readonly<Record<string, string>>,
): Attempt<T> {
  const { method, path } = request;
  const { status } = response;
  if (response.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
    const error = new BonumUnexpectedResponseError(
      `Bonum answered ${method} ${path} with a redirect (HTTP ${status}). The SDK never follows ` +
        'redirects, so your credentials cannot leak to another host. Check baseUrl.',
    );
    return { ok: false, error, retryable: false, retryAfterMs: null, status, auth };
  }
  const hide = request.hideBody === true;
  if (response.ok) {
    return {
      ok: true,
      value: request.parse(parseJson(text, `${method} ${path}`, status, hide)),
    };
  }
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), Date.now());
  const details = { status, body: hide ? null : errorBody(text), method, path, retryAfterMs };
  const error = createApiError(details, hints);
  return { ok: false, error, retryable: isRetryableStatus(status), retryAfterMs, status, auth };
}

function parseJson(text: string, request: string, status: number, hide: boolean): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    // A hidden body also drops the `cause`: a JSON SyntaxError quotes the text it failed on.
    throw new BonumUnexpectedResponseError(
      `Bonum answered ${request} with HTTP ${status}, but the body is not JSON.`,
      hide ? {} : { cause: error, body: excerpt(text) },
    );
  }
}

// One caller's abort must not cancel a token request others share, but it may stop waiting for it.
function untilAborted<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return pending;
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function errorBody(text: string): unknown {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return excerpt(text);
  }
}

function excerpt(text: string): string {
  return text.length > MAX_BODY_EXCERPT ? `${text.slice(0, MAX_BODY_EXCERPT)}…` : text;
}

function timeoutMessage(request: HttpRequest<unknown>, timeoutMs: number): string {
  const { method, path } = request;
  const advice =
    request.timeoutAdvice ??
    (method === 'POST'
      ? 'The payment may still have been created: look it up by orderId before asking the customer to pay again.'
      : 'Try again, or raise timeoutMs.');
  return `Bonum did not answer ${method} ${path} within ${timeoutMs} ms. ${advice}`;
}

// Node's fetch reports "fetch failed" and puts the useful part (ECONNREFUSED, ENOTFOUND …) in `cause`.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}
