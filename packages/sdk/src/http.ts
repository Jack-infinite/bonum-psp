import { createApiError } from './api-errors.js';
import type { ResolvedClientConfig } from './config.js';
import { BonumConnectionError, BonumTimeoutError, BonumUnexpectedResponseError } from './errors.js';
import { isRetryableStatus, parseRetryAfterMs, retryDelayMs } from './retry.js';

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
  /** Checks the 2xx JSON body; throws `BonumUnexpectedResponseError` on a mismatch. */
  parse: (data: unknown) => T;
  /** Whether network errors, timeouts, 429 and 5xx may be retried. */
  retry: boolean;
  /** Timeout per attempt; defaults to the client's `timeoutMs`. */
  timeoutMs?: number | undefined;
  /** The caller's signal. Its abort reason is rethrown unchanged. */
  signal?: AbortSignal | undefined;
}

type Attempt<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error; retryable: boolean; retryAfterMs: number | null };

/** Sends requests to Bonum: auth headers, timeouts, retries and error mapping. */
export class HttpClient {
  readonly #config: ResolvedClientConfig;
  readonly #merchantKey: string;

  constructor(config: ResolvedClientConfig, merchantKey: string) {
    this.#config = config;
    this.#merchantKey = merchantKey;
  }

  /** Sends the request, retrying when allowed, and returns the parsed body. */
  async request<T>(request: HttpRequest<T>): Promise<T> {
    const maxRetries = request.retry ? this.#config.maxRetries : 0;
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.#attempt(request);
      if (result.ok) return result.value;
      if (!result.retryable || attempt >= maxRetries) throw result.error;
      await this.#config.sleep(
        retryDelayMs(attempt, result.retryAfterMs, this.#config.random),
        request.signal,
      );
    }
  }

  async #attempt<T>(request: HttpRequest<T>): Promise<Attempt<T>> {
    request.signal?.throwIfAborted();
    const timeoutMs = request.timeoutMs ?? this.#config.timeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal =
      request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
    const fetch = this.#config.fetch;
    let response: Response;
    let text: string;
    try {
      response = await fetch(this.#url(request), this.#init(request, signal));
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
      return { ok: false, error: failure, retryable: true, retryAfterMs: null };
    }
    return handleResponse(request, response, text);
  }

  #url(request: HttpRequest<unknown>): string {
    const query = Object.entries(request.query ?? {})
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return `${this.#config.baseUrl}${request.path}${query === '' ? '' : `?${query}`}`;
  }

  #init(request: HttpRequest<unknown>, signal: AbortSignal): RequestInit {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.#config.userAgent,
      'x-merchant-key': this.#merchantKey,
    };
    if (request.method === 'POST') headers['content-type'] = 'application/json';
    // 'manual' rather than 'error': Cloudflare Workers rejects 'error'. Redirects fail below either way,
    // so the merchant key is never sent to another host.
    const init: RequestInit = { method: request.method, headers, signal, redirect: 'manual' };
    if (request.body !== undefined) init.body = JSON.stringify(request.body);
    return init;
  }
}

function handleResponse<T>(request: HttpRequest<T>, response: Response, text: string): Attempt<T> {
  const { method, path } = request;
  const { status } = response;
  if (response.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
    const error = new BonumUnexpectedResponseError(
      `Bonum answered ${method} ${path} with a redirect (HTTP ${status}). The SDK never follows ` +
        'redirects, so the merchant key cannot leak to another host. Check baseUrl.',
    );
    return { ok: false, error, retryable: false, retryAfterMs: null };
  }
  if (response.ok)
    return { ok: true, value: request.parse(parseJson(text, `${method} ${path}`, status)) };
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), Date.now());
  const error = createApiError({ status, body: errorBody(text), method, path, retryAfterMs });
  return { ok: false, error, retryable: isRetryableStatus(status), retryAfterMs };
}

function parseJson(text: string, request: string, status: number): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new BonumUnexpectedResponseError(
      `Bonum answered ${request} with HTTP ${status}, but the body is not JSON.`,
      { cause: error, body: excerpt(text) },
    );
  }
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

function timeoutMessage({ method, path }: HttpRequest<unknown>, timeoutMs: number): string {
  const advice =
    method === 'POST'
      ? 'The payment may still have been created: look it up by orderId before asking the customer to pay again.'
      : 'Try again, or raise timeoutMs.';
  return `Bonum did not answer ${method} ${path} within ${timeoutMs} ms. ${advice}`;
}

// Node's fetch reports "fetch failed" and puts the useful part (ECONNREFUSED, ENOTFOUND …) in `cause`.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}
