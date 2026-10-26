import { HttpClient } from '../http.js';
import {
  type BonumTransportOptions,
  resolveCredential,
  resolveFunction,
  resolveTransport,
} from '../transport.js';
import type { BonumEnvironment } from '../types.js';
import { Invoices } from './invoices.js';
import { bearerProfile, GatewayTokens } from './tokens.js';
import { BonumGatewayWebhooks } from './webhooks.js';

/**
 * The Bonum Gateway API base URL for each environment.
 *
 * @example
 * ```ts
 * BONUM_GATEWAY_BASE_URLS.sandbox; // 'https://testapi.bonum.mn'
 * ```
 */
export const BONUM_GATEWAY_BASE_URLS: Readonly<Record<BonumEnvironment, string>> = Object.freeze({
  sandbox: 'https://testapi.bonum.mn',
  production: 'https://apis.bonum.mn',
});

/**
 * Options for `new BonumGatewayClient()`. Everything is validated once, in the constructor.
 *
 * @example
 * ```ts
 * const options: BonumGatewayClientOptions = { environment: 'sandbox', terminalId: '00000001' };
 * ```
 */
export interface BonumGatewayClientOptions extends BonumTransportOptions {
  /** App secret from Bonum's merchant portal. Defaults to env `BONUM_GATEWAY_APP_SECRET`. Server-side only. */
  appSecret?: string | undefined;
  /** Terminal id from Bonum's merchant portal. Defaults to env `BONUM_GATEWAY_TERMINAL_ID`. */
  terminalId?: string | undefined;
  /** Checksum key(s) for `gateway.webhooks`. Defaults to env `BONUM_GATEWAY_CHECKSUM_KEY`. */
  checksumKey?: string | readonly string[] | undefined;
  /** Testing hook: current time in milliseconds, for token expiry. Defaults to `Date.now`. */
  now?: (() => number) | undefined;
}

/**
 * The Bonum Gateway client: invoices that open Bonum's checkout page (QPay, cards, WeChat Pay and
 * more) and their webhooks. Create one per process and reuse it, so its access token is reused
 * too. Server-side only: it holds your app secret.
 *
 * @example
 * ```ts
 * import { BonumGatewayClient } from 'bonum-psp';
 *
 * // App secret and terminal id from BONUM_GATEWAY_APP_SECRET and BONUM_GATEWAY_TERMINAL_ID
 * const gateway = new BonumGatewayClient({ environment: 'sandbox' });
 * const invoice = await gateway.invoices.create({
 *   amount: 5000,
 *   transactionId: 'ORD-1001',
 *   expiresIn: 900,
 * });
 * ```
 */
export class BonumGatewayClient {
  /** The environment this client talks to. */
  readonly environment: BonumEnvironment;
  /** The API base URL in use, without a trailing slash. */
  readonly baseUrl: string;
  /** The terminal invoices are created for. */
  readonly terminalId: string;
  /** Create invoices and list payment methods. */
  readonly invoices: Invoices;
  #webhooks: BonumGatewayWebhooks | undefined;

  constructor(options: BonumGatewayClientOptions = {}) {
    const config = resolveTransport(options, {
      client: 'BonumGatewayClient',
      baseUrls: BONUM_GATEWAY_BASE_URLS,
    });
    const appSecret = resolveCredential(options.appSecret, 'BonumGatewayClient', {
      option: 'appSecret',
      env: 'BONUM_GATEWAY_APP_SECRET',
      label: 'Bonum Gateway app secret',
      source: 'Create it in the Bonum merchant portal (https://merchant.bonum.mn).',
    });
    this.terminalId = resolveCredential(options.terminalId, 'BonumGatewayClient', {
      option: 'terminalId',
      env: 'BONUM_GATEWAY_TERMINAL_ID',
      label: 'Bonum Gateway terminal id',
      source: 'Create a terminal in the Bonum merchant portal and use its terminalId.',
    });
    const now = resolveFunction(options.now, 'now') ?? Date.now;
    const tokens = new GatewayTokens(config, appSecret, this.terminalId, now);
    this.environment = config.environment;
    this.baseUrl = config.baseUrl;
    this.invoices = new Invoices(new HttpClient(config, bearerProfile(tokens)));
    // An explicit key is validated now; the env fallback waits until webhooks are first used.
    if (options.checksumKey !== undefined) {
      this.#webhooks = new BonumGatewayWebhooks({ checksumKey: options.checksumKey });
    }
  }

  /**
   * Webhook verification with the client's `checksumKey` (or env `BONUM_GATEWAY_CHECKSUM_KEY`).
   * Throws `BonumConfigError` on first use when no key is configured.
   *
   * @example
   * ```ts
   * const event = await gateway.webhooks.verify(req.body, req.headers);
   * ```
   */
  get webhooks(): BonumGatewayWebhooks {
    this.#webhooks ??= new BonumGatewayWebhooks();
    return this.#webhooks;
  }
}
