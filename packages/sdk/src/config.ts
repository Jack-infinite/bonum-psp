import { merchantKeyProfile } from './api-profiles.js';
import type { HttpProfile } from './http.js';
import {
  type BonumTransportOptions,
  type ResolvedTransport,
  resolveCredential,
  resolveTransport,
} from './transport.js';
import type { BonumEnvironment } from './types.js';

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
export interface BonumClientOptions extends BonumTransportOptions {
  /** Merchant key issued by Bonum. Defaults to env `BONUM_MERCHANT_KEY`. Server-side only. */
  merchantKey?: string | undefined;
  /** Webhook signing secret(s) for `bonum.webhooks`. Defaults to env `BONUM_WEBHOOK_SECRET`. */
  webhookSecret?: string | readonly string[] | undefined;
}

/** Validates client options, falling back to environment variables where documented. */
export function resolveClientConfig(options: BonumClientOptions): {
  config: ResolvedTransport;
  profile: HttpProfile;
} {
  const config = resolveTransport(options, { client: 'BonumClient', baseUrls: BONUM_BASE_URLS });
  const merchantKey = resolveCredential(options.merchantKey, 'BonumClient', {
    option: 'merchantKey',
    env: 'BONUM_MERCHANT_KEY',
    label: 'Bonum merchant key',
    source: 'Bonum issues the key during onboarding.',
  });
  return { config, profile: merchantKeyProfile(merchantKey) };
}
