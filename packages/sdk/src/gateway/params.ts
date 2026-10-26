import type { PaymentProvider } from './types.js';

/**
 * The language of the checkout page and of Bonum's messages. Bonum's default is Mongolian.
 *
 * @example
 * ```ts
 * const language: InvoiceLanguage = 'en';
 * ```
 */
export type InvoiceLanguage = 'mn' | 'en';

/**
 * A line shown on the checkout page. Display only: Bonum charges the invoice `amount`.
 *
 * @example
 * ```ts
 * const item: InvoiceItem = { title: 'Coffee', amount: 5000, count: 1 };
 * ```
 */
export interface InvoiceItem {
  /** Product name. */
  title: string;
  /** Unit price in major units (MNT), at most 2 decimal places. */
  amount: number;
  /** Quantity, a whole number from 1. */
  count: number;
  /** A short note under the title. */
  remark?: string | undefined;
  /** Product image URL (`https:`). */
  image?: string | undefined;
}

/**
 * Parameters for `gateway.invoices.create()`.
 *
 * @example
 * ```ts
 * const params: CreateInvoiceParams = {
 *   amount: 5000,
 *   transactionId: 'ORD-1001',
 *   expiresIn: 900,
 *   callbackUrl: 'https://shop.example/orders/ORD-1001',
 * };
 * ```
 */
export interface CreateInvoiceParams {
  /** Amount to charge in major units (MNT), at least 1, at most 2 decimal places. */
  amount: number;
  /**
   * Your unique id for this invoice, 1–80 characters. Webhooks carry it back. Bonum rejects a
   * repeated one with HTTP 409, so use a new id for every invoice, not only for every order.
   */
  transactionId: string;
  /** Seconds until the invoice expires, a whole number from 1. */
  expiresIn: number;
  /** Where the browser returns after payment, cancellation or expiry (`https:` or `http:`). */
  callbackUrl?: string | undefined;
  /** Limits the checkout page to these payment methods. Default: every enabled one. */
  providers?: readonly PaymentProvider[] | undefined;
  /** Lines to show on the checkout page. */
  items?: readonly InvoiceItem[] | undefined;
  /** Checkout page language. Default: Bonum's (Mongolian). */
  language?: InvoiceLanguage | undefined;
}
