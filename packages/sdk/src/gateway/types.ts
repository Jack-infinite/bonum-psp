type OpenString = string & Record<never, never>;

/**
 * Payment methods the Bonum checkout page can offer. Which ones are on depends on your terminal:
 * ask with `gateway.invoices.listProviders()`. An open union, so new providers don't break you.
 *
 * @example
 * ```ts
 * await gateway.invoices.create({ ...params, providers: [PaymentProvider.QPAY] });
 * ```
 */
export const PaymentProvider = {
  /** QR payment, accepted by every Mongolian bank app. */
  QPAY: 'QPAY',
  /** Online card payment. */
  E_COMMERCE: 'E_COMMERCE',
  /** WeChat Pay wallet. */
  WE_CHAT: 'WE_CHAT',
  /** SonoShop buy now, pay later. */
  SONO_SHOP: 'SONO_SHOP',
  NEO_APP: 'NEO_APP',
  BONUM_QR: 'BONUM_QR',
  APPLE_PAY: 'APPLE_PAY',
  GOOGLE_PAY: 'GOOGLE_PAY',
  DIGI_PAY: 'DIGI_PAY',
} as const;

/**
 * One of the {@link PaymentProvider} values, or a provider this SDK does not know yet.
 *
 * @example
 * ```ts
 * const provider: PaymentProvider = 'QPAY';
 * ```
 */
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider] | OpenString;

/**
 * Whether a payment method is switched on for your terminal.
 *
 * @example
 * ```ts
 * const providers: PaymentProviderStatus[] = await gateway.invoices.listProviders();
 * const enabled = providers.filter((p) => p.enabled).map((p) => p.provider);
 * ```
 */
export interface PaymentProviderStatus {
  provider: PaymentProvider;
  enabled: boolean;
}

/**
 * A created invoice. Send the customer to `followUpLink`; the result arrives by webhook.
 *
 * @example
 * ```ts
 * const invoice: Invoice = await gateway.invoices.create(params);
 * return Response.redirect(invoice.followUpLink, 303);
 * ```
 */
export interface Invoice {
  /** Bonum's id for the invoice, as the create call returned it. */
  invoiceId: string;
  /** The Bonum checkout page for this invoice, e.g. `https://ecommerce.bonum.mn/ecommerce?invoiceId=…`. */
  followUpLink: string;
  /** Your `transactionId`. Webhooks carry it: match them to your order with it. */
  transactionId: string;
}
