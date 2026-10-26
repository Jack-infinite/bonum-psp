import { type BonumClientOptions, resolveClientConfig } from './config.js';
import { HttpClient } from './http.js';
import { Payments } from './payments.js';
import type { BonumEnvironment } from './types.js';

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

  constructor(options: BonumClientOptions = {}) {
    const { config, merchantKey } = resolveClientConfig(options);
    this.environment = config.environment;
    this.baseUrl = config.baseUrl;
    this.payments = new Payments(new HttpClient(config, merchantKey));
  }
}
