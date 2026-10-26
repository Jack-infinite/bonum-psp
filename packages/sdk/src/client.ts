import { type BonumClientOptions, resolveClientConfig } from './config.js';
import { HttpClient } from './http.js';
import { Payments } from './payments.js';
import type { BonumEnvironment } from './types.js';
import { BonumWebhooks } from './webhooks/webhooks.js';

/**
 * The Bonum PSP V2 client. Create one per process and reuse it. Server-side only: it holds your
 * merchant key, which must never reach a browser or an app.
 *
 * @example
 * ```ts
 * import { BonumClient } from 'bonum-psp';
 *
 * const bonum = new BonumClient({ environment: 'sandbox' }); // key from BONUM_MERCHANT_KEY
 * const payment = await bonum.payments.getByOrderId('ORD-1001');
 * ```
 */
export class BonumClient {
  /** The environment this client talks to. */
  readonly environment: BonumEnvironment;
  /** The API base URL in use, without a trailing slash. */
  readonly baseUrl: string;
  /** Submit wallet payments and look them up. */
  readonly payments: Payments;
  #webhooks: BonumWebhooks | undefined;

  constructor(options: BonumClientOptions = {}) {
    const { config, merchantKey } = resolveClientConfig(options);
    this.environment = config.environment;
    this.baseUrl = config.baseUrl;
    this.payments = new Payments(new HttpClient(config, merchantKey));
    // An explicit secret is validated now; the env fallback waits until webhooks are first used.
    if (options.webhookSecret !== undefined) {
      this.#webhooks = new BonumWebhooks({ secret: options.webhookSecret });
    }
  }

  /**
   * Webhook verification with the client's `webhookSecret` (or env `BONUM_WEBHOOK_SECRET`).
   * Throws `BonumConfigError` on first use when no secret is configured.
   *
   * @example
   * ```ts
   * const event = await bonum.webhooks.verify(req.body, req.headers);
   * ```
   */
  get webhooks(): BonumWebhooks {
    this.#webhooks ??= new BonumWebhooks();
    return this.#webhooks;
  }
}
