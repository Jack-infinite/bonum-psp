import { BonumConfigError } from './errors.js';
import { sleep } from './retry.js';
import { assertServerRuntime, readEnv } from './runtime.js';
import type { BonumEnvironment } from './types.js';
import { isPositiveInteger } from './validation.js';
import { VERSION } from './version.js';

/**
 * A `fetch`-compatible function. The global `fetch` of Node.js, Bun, Deno and Workers all fit.
 *
 * @example
 * ```ts
 * const loggingFetch: FetchFunction = (url, init) => fetch(url, init);
 * ```
 */
export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Waits between retries. Must reject with `signal.reason` when the signal aborts.
 *
 * @example
 * ```ts
 * const noWait: SleepFunction = async () => {};
 * ```
 */
export type SleepFunction = (ms: number, signal?: AbortSignal) => Promise<void>;

/**
 * Bonum's API base URL for each environment.
 *
 * @example
 * ```ts
 * BONUM_BASE_URLS.sandbox; // 'https://testpsp.bonum.mn'
 * ```
 */
export const BONUM_BASE_URLS: Readonly<Record<BonumEnvironment, string>> = Object.freeze({
  sandbox: 'https://testpsp.bonum.mn',
  production: 'https://psp.bonum.mn',
});

/**
 * Options for `new BonumClient()`. Everything is validated once, in the constructor.
 *
 * @example
 * ```ts
 * const options: BonumClientOptions = { environment: 'sandbox', timeoutMs: 10_000 };
 * ```
 */
export interface BonumClientOptions {
  /** Merchant key issued by Bonum. Defaults to env `BONUM_MERCHANT_KEY`. Server-side only. */
  merchantKey?: string | undefined;
  /** `'sandbox'` or `'production'`. Defaults to env `BONUM_ENV`; there is no silent default. */
  environment?: BonumEnvironment | undefined;
  /** Override the API base URL, e.g. for a proxy. Must be `https:` (plain `http:` only for localhost). */
  baseUrl?: string | undefined;
  /** Timeout per HTTP attempt in milliseconds. Default 15 000. */
  timeoutMs?: number | undefined;
  /** Retries after a network error, timeout, 429 or 5xx (0–10). Default 2. */
  maxRetries?: number | undefined;
  /** Custom `fetch`, e.g. for tests or instrumentation. Defaults to the global `fetch`. */
  fetch?: FetchFunction | undefined;
  /** Appended to the `user-agent` header, e.g. `"my-shop/1.4.0"`. */
  userAgent?: string | undefined;
  /** Allow construction where `window` and `document` exist. Only for browser-like test runners. */
  dangerouslyAllowBrowser?: boolean | undefined;
  /** Testing hook: replaces the wait between retries. */
  sleep?: SleepFunction | undefined;
  /** Testing hook: random source in [0, 1) for retry jitter. Defaults to `Math.random`. */
  random?: (() => number) | undefined;
}

/** The validated, frozen client configuration. The merchant key is kept separately. */
export interface ResolvedClientConfig {
  readonly environment: BonumEnvironment;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly userAgent: string;
  readonly fetch: FetchFunction;
  readonly sleep: SleepFunction;
  readonly random: () => number;
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_RETRIES_LIMIT = 10;

/** Validates client options, falling back to environment variables where documented. */
export function resolveClientConfig(options: BonumClientOptions): {
  config: ResolvedClientConfig;
  merchantKey: string;
} {
  // Not isRecord(): that type guard would widen every option to `unknown`.
  if (typeof options !== 'object' || options === null) {
    throw new BonumConfigError('BonumClient options must be an object.');
  }
  assertServerRuntime(options.dangerouslyAllowBrowser);
  const merchantKey = resolveMerchantKey(options.merchantKey);
  const environment = resolveEnvironment(options.environment);
  const config: ResolvedClientConfig = Object.freeze({
    environment,
    baseUrl: resolveBaseUrl(options.baseUrl, environment),
    timeoutMs: resolveTimeoutMs(options.timeoutMs),
    maxRetries: resolveMaxRetries(options.maxRetries),
    userAgent: resolveUserAgent(options.userAgent),
    fetch: resolveFetch(options.fetch),
    sleep: resolveFunction(options.sleep, 'sleep') ?? sleep,
    random: resolveFunction(options.random, 'random') ?? Math.random,
  });
  return { config, merchantKey };
}

function resolveMerchantKey(value: unknown): string {
  const key = value === undefined ? readEnv('BONUM_MERCHANT_KEY') : value;
  if (typeof key !== 'string' || key.trim() === '') {
    throw new BonumConfigError(
      'Missing Bonum merchant key. Pass `merchantKey` to `new BonumClient()` or set the ' +
        'BONUM_MERCHANT_KEY environment variable. Bonum issues the key during onboarding.',
    );
  }
  const trimmed = key.trim();
  if (/[\s\p{Cc}]/u.test(trimmed)) {
    throw new BonumConfigError(
      'The Bonum merchant key contains whitespace or control characters; copy it again from Bonum.',
    );
  }
  return trimmed;
}

function resolveEnvironment(value: unknown): BonumEnvironment {
  const environment = value === undefined ? readEnv('BONUM_ENV') : value;
  if (environment === 'sandbox' || environment === 'production') return environment;
  throw new BonumConfigError(
    environment === undefined
      ? "Missing Bonum environment. Pass `environment: 'sandbox'` or `'production'` to `new BonumClient()` " +
          'or set BONUM_ENV. The SDK never guesses, so test traffic cannot reach production by accident.'
      : "The Bonum environment must be 'sandbox' or 'production'; check the `environment` option or BONUM_ENV.",
  );
}

function resolveBaseUrl(value: unknown, environment: BonumEnvironment): string {
  if (value === undefined) return BONUM_BASE_URLS[environment];
  const url = typeof value === 'string' && URL.canParse(value) ? new URL(value) : undefined;
  if (url === undefined) {
    throw new BonumConfigError('baseUrl must be an absolute URL such as https://psp.bonum.mn.');
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new BonumConfigError(
      'baseUrl must use https: (plain http: is allowed only for localhost).',
    );
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new BonumConfigError(
      'baseUrl must not contain credentials, a query string or a fragment.',
    );
  }
  return url.href.replace(/\/+$/, '');
}

function resolveTimeoutMs(value: unknown): number {
  if (value === undefined) return 15_000;
  if (!isPositiveInteger(value)) {
    throw new BonumConfigError('timeoutMs must be a positive integer number of milliseconds.');
  }
  return value;
}

function resolveMaxRetries(value: unknown): number {
  if (value === undefined) return 2;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_RETRIES_LIMIT
  ) {
    throw new BonumConfigError(`maxRetries must be an integer from 0 to ${MAX_RETRIES_LIMIT}.`);
  }
  return value;
}

function resolveUserAgent(value: unknown): string {
  const sdk = `bonum-psp/${VERSION}`;
  if (value === undefined) return sdk;
  if (typeof value !== 'string' || value.trim() === '' || !/^[\x20-\x7e]+$/.test(value)) {
    throw new BonumConfigError('userAgent must be printable ASCII text, e.g. "my-shop/1.4.0".');
  }
  return `${sdk} ${value.trim()}`;
}

function resolveFetch(value: FetchFunction | undefined): FetchFunction {
  const custom = resolveFunction(value, 'fetch');
  if (custom !== undefined) return custom;
  if (typeof globalThis.fetch !== 'function') {
    throw new BonumConfigError(
      'No global fetch found. Use Node.js 22.12 or later, or pass `fetch`.',
    );
  }
  // Some runtimes (e.g. Cloudflare Workers) throw "Illegal invocation" when fetch is not called
  // as a plain function, so never store the global itself.
  return (url, init) => globalThis.fetch(url, init);
}

function resolveFunction<T>(value: T | undefined, name: string): T | undefined {
  if (value !== undefined && typeof value !== 'function') {
    throw new BonumConfigError(`${name} must be a function.`);
  }
  return value;
}
