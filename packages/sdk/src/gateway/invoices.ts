import type { HttpClient } from '../http.js';
import type { RequestOptions } from '../params.js';
import { validateRequestOptions } from '../validation.js';
import type { CreateInvoiceParams } from './params.js';
import { parseInvoice, parseProviders } from './responses.js';
import type { Invoice, PaymentProviderStatus } from './types.js';
import { validateCreateInvoice } from './validation.js';

const INVOICES = '/bonum-gateway/ecommerce/invoices';

/**
 * Creates Bonum checkout invoices. Use it as `gateway.invoices`.
 *
 * Creating is never retried automatically: Bonum answers a repeated `transactionId` with 409
 * instead of returning the first invoice, so a retry after a lost response could not succeed.
 *
 * @example
 * ```ts
 * const invoice = await gateway.invoices.create({
 *   amount: 5000,
 *   transactionId: 'ORD-1001',
 *   expiresIn: 900,
 * });
 * console.log(invoice.followUpLink); // send the customer here
 * ```
 */
export class Invoices {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Creates an invoice and returns the checkout link to send the customer to. Whether it was paid
   * arrives later, by webhook to the URL registered in Bonum's merchant portal.
   *
   * @example
   * ```ts
   * const { followUpLink } = await gateway.invoices.create({
   *   amount: 5000,
   *   transactionId: `ORD-1001-${attempt}`,
   *   expiresIn: 900,
   *   callbackUrl: 'https://shop.example/orders/ORD-1001',
   *   providers: ['QPAY'],
   * });
   * ```
   */
  async create(params: CreateInvoiceParams, options?: RequestOptions): Promise<Invoice> {
    const { body, transactionId, language } = validateCreateInvoice(params);
    const { signal, timeoutMs } = validateRequestOptions(options);
    return this.#http.request({
      method: 'POST',
      path: INVOICES,
      body,
      headers: language === undefined ? undefined : { 'accept-language': language },
      parse: (data) => parseInvoice(data, transactionId),
      retry: false,
      timeoutMs,
      signal,
      timeoutAdvice:
        `The invoice may still have been created: its webhook will carry transactionId ` +
        `"${transactionId}". Create a new invoice only with a new transactionId.`,
    });
  }

  /**
   * Lists the payment methods and whether each is enabled for your terminal.
   *
   * @example
   * ```ts
   * const providers = await gateway.invoices.listProviders();
   * // [{ provider: 'QPAY', enabled: true }, { provider: 'E_COMMERCE', enabled: true }, …]
   * ```
   */
  async listProviders(options?: RequestOptions): Promise<PaymentProviderStatus[]> {
    const { signal, timeoutMs } = validateRequestOptions(options);
    return this.#http.request({
      method: 'GET',
      path: `${INVOICES}/payment-providers`,
      parse: parseProviders,
      retry: true,
      timeoutMs,
      signal,
    });
  }
}
