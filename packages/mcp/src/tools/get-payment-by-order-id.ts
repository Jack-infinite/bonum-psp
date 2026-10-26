import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { registerPaymentLookup } from './payment-output.js';
import { orderIdSchema } from './schemas.js';
import { requireClient } from './tool.js';

const inputSchema = z.object({
  orderId: orderIdSchema.describe(
    'Your order_id, exactly as it was sent when the payment was submitted.',
  ),
});

/** `get_payment_by_order_id`: the current state of a payment by the merchant's `order_id`. */
export function registerGetPaymentByOrderId(server: McpServer, deps: ResolvedDeps): void {
  registerPaymentLookup(server, deps, {
    name: 'get_payment_by_order_id',
    title: 'Get payment by order id',
    description:
      'Look up the current state of a Bonum payment by the merchant order_id, e.g. ' +
      '"What is the status of order ORD-1001?". Use it when you know the order but not the ' +
      'paymentId. Only AUTHORIZED is safe to fulfil.',
    inputSchema,
    lookup: ({ orderId }, signal) => requireClient(deps).payments.getByOrderId(orderId, { signal }),
  });
}
