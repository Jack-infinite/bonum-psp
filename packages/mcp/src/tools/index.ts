import type { McpServer } from '@modelcontextprotocol/server';
import type { ResolvedDeps } from '../deps.js';
import { registerCheckConnection } from './check-connection.js';
import { registerCreateInvoice } from './create-invoice.js';
import { registerCreateTestWebhook } from './create-test-webhook.js';
import { registerGetPayment } from './get-payment.js';
import { registerGetPaymentByOrderId } from './get-payment-by-order-id.js';
import { registerListPaymentProviders } from './list-payment-providers.js';
import { registerSendTestWebhook } from './send-test-webhook.js';
import { registerVerifyInvoiceWebhook } from './verify-invoice-webhook.js';
import { registerVerifyWebhook } from './verify-webhook.js';
import { registerWaitForPaymentResult } from './wait-for-payment-result.js';

/**
 * Registers the ten tools. None of them submits wallet payments (tokens only come from devices);
 * `create_invoice` creates checkout invoices that the customer pays on Bonum's page.
 */
export function registerTools(server: McpServer, deps: ResolvedDeps): void {
  registerCheckConnection(server, deps);
  registerGetPayment(server, deps);
  registerGetPaymentByOrderId(server, deps);
  registerWaitForPaymentResult(server, deps);
  registerVerifyWebhook(server, deps);
  registerCreateTestWebhook(server, deps);
  registerSendTestWebhook(server, deps);
  registerCreateInvoice(server, deps);
  registerListPaymentProviders(server, deps);
  registerVerifyInvoiceWebhook(server, deps);
}
