import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { registerPaymentLookup } from './payment-output.js';
import { paymentIdSchema } from './schemas.js';
import { requireClient } from './tool.js';

const inputSchema = z.object({
  paymentId: paymentIdSchema.describe(
    'Bonum paymentId (UUID), from the submission response or a webhook.',
  ),
});

/** `get_payment`: the current state of a payment by Bonum's `paymentId`. */
export function registerGetPayment(server: McpServer, deps: ResolvedDeps): void {
  registerPaymentLookup(server, deps, {
    name: 'get_payment',
    title: 'Get payment',
    description:
      'Look up the current state of a Bonum payment by its paymentId (UUID): status, amount, ' +
      'currency, wallet and failure reason. Use it to check whether an order is paid, or to ' +
      'reconcile a payment whose webhook never arrived. Only AUTHORIZED is safe to fulfil.',
    inputSchema,
    lookup: ({ paymentId }, signal) => requireClient(deps).payments.get(paymentId, { signal }),
  });
}
