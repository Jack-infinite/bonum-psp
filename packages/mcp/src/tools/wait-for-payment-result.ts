import type { McpServer } from '@modelcontextprotocol/server';
import { isTerminalStatus } from 'bonum-psp';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { explainStatus } from './payment-output.js';
import { paymentIdSchema } from './schemas.js';
import { registerTool, requireClient } from './tool.js';

const inputSchema = z.object({
  paymentId: paymentIdSchema.describe('Bonum paymentId (UUID) of a submitted payment.'),
  waitMs: z
    .number()
    .int()
    .min(1)
    .max(28_000)
    .default(25_000)
    .describe('How long Bonum may hold the request open, in milliseconds (1–28000).'),
});

const outputSchema = z.object({
  environment: z.enum(['sandbox', 'production']).describe('The Bonum environment of this data.'),
  paymentId: z.string(),
  status: z
    .enum(['PENDING', 'AUTHORIZED', 'FAILED'])
    .describe('Only AUTHORIZED is safe to fulfil.'),
  isTerminal: z.boolean().describe('true for AUTHORIZED and FAILED, which no longer change.'),
  failureReason: z.string().nullable(),
  timedOut: z.boolean().describe('true when the wait ended before the bank answered.'),
});

/** `wait_for_payment_result`: long-polls Bonum's await endpoint for the bank's answer. */
export function registerWaitForPaymentResult(server: McpServer, deps: ResolvedDeps): void {
  registerTool(server, deps, {
    name: 'wait_for_payment_result',
    title: 'Wait for payment result',
    description:
      "Wait (up to 28 s) for the bank's answer to a payment that is still PENDING, using Bonum's " +
      'await endpoint. Use it right after a payment was submitted; for an older payment, ' +
      'get_payment answers immediately.',
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
    callsBonum: true,
    async run({ paymentId, waitMs }, signal) {
      const result = await requireClient(deps).payments.waitForResult(paymentId, {
        waitMs,
        signal,
      });
      const summary = result.timedOut
        ? `Payment ${paymentId} is still PENDING after waiting ${waitMs / 1000} s: the bank has ` +
          'not answered yet. Do not fulfil; the webhook will deliver the result, or check again ' +
          'with get_payment.'
        : `Payment ${paymentId}: ${explainStatus(result.status, result.failureReason)}`;
      const data = {
        environment: deps.environment,
        ...result,
        isTerminal: isTerminalStatus(result.status),
      };
      return { summary, data };
    },
  });
}
