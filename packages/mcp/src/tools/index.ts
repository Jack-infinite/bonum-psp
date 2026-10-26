import type { McpServer } from '@modelcontextprotocol/server';
import type { ResolvedDeps } from '../deps.js';
import { registerCheckConnection } from './check-connection.js';
import { registerCreateTestWebhook } from './create-test-webhook.js';
import { registerGetPayment } from './get-payment.js';
import { registerGetPaymentByOrderId } from './get-payment-by-order-id.js';
import { registerSendTestWebhook } from './send-test-webhook.js';
import { registerVerifyWebhook } from './verify-webhook.js';
import { registerWaitForPaymentResult } from './wait-for-payment-result.js';

/** Registers the seven tools. None of them submits payments: wallet tokens only come from devices. */
export function registerTools(server: McpServer, deps: ResolvedDeps): void {
  registerCheckConnection(server, deps);
  registerGetPayment(server, deps);
  registerGetPaymentByOrderId(server, deps);
  registerWaitForPaymentResult(server, deps);
  registerVerifyWebhook(server, deps);
  registerCreateTestWebhook(server, deps);
  registerSendTestWebhook(server, deps);
}
