import type { McpServer } from '@modelcontextprotocol/server';
import {
  type BonumEnvironment,
  isTerminalStatus,
  normalizeCurrency,
  type Payment,
  type PaymentStatus,
} from 'bonum-psp';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { registerTool, type ToolAnswer } from './tool.js';

const paymentOutputSchema = z.object({
  environment: z.enum(['sandbox', 'production']).describe('The Bonum environment of this data.'),
  paymentId: z.string(),
  orderId: z.string(),
  status: z
    .enum(['PENDING', 'AUTHORIZED', 'FAILED'])
    .describe('Only AUTHORIZED is safe to fulfil.'),
  isTerminal: z.boolean().describe('true for AUTHORIZED and FAILED, which no longer change.'),
  amount: z.string().describe('Decimal string in major units, e.g. "150.50".'),
  currency: z.string().describe('Exactly as Bonum sent it: alpha ("MNT") or ISO numeric ("496").'),
  normalizedCurrency: z.string().describe('The alpha code, e.g. "MNT" for "496".'),
  walletType: z.string(),
  providerReference: z.string().nullable().describe('Bank reference, set once AUTHORIZED.'),
  failureReason: z.string().nullable().describe('Why the payment failed, set once FAILED.'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A tool that looks up one payment; `get_payment` and `get_payment_by_order_id` share this. */
export interface PaymentLookupTool<Input extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: Input;
  lookup(input: z.output<Input>, signal: AbortSignal): Promise<Payment>;
}

/** Registers a payment lookup with the shared output schema, summary and annotations. */
export function registerPaymentLookup<Input extends z.ZodObject>(
  server: McpServer,
  deps: ResolvedDeps,
  { lookup, ...tool }: PaymentLookupTool<Input>,
): void {
  registerTool(server, deps, {
    ...tool,
    outputSchema: paymentOutputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    callsBonum: true,
    run: async (input, signal) => paymentAnswer(await lookup(input, signal), deps.environment),
  });
}

function paymentAnswer(
  payment: Payment,
  environment: BonumEnvironment,
): ToolAnswer<z.output<typeof paymentOutputSchema>> {
  const normalizedCurrency = normalizeCurrency(payment.currency);
  const currency =
    normalizedCurrency === payment.currency
      ? payment.currency
      : `${normalizedCurrency} (Bonum sent "${payment.currency}")`;
  const reference =
    payment.providerReference === null ? '' : `, provider reference ${payment.providerReference}`;
  const summary = [
    `Payment ${payment.paymentId} for order ${payment.orderId}: ` +
      explainStatus(payment.status, payment.failureReason),
    `Amount ${payment.amount} ${currency}, paid with ${payment.walletType}${reference}.`,
    `Created ${payment.createdAt}, last updated ${payment.updatedAt}.`,
  ].join('\n');
  const isTerminal = isTerminalStatus(payment.status);
  return { summary, data: { environment, ...payment, isTerminal, normalizedCurrency } };
}

/** One sentence on what a status means for the merchant. */
export function explainStatus(status: PaymentStatus, failureReason: string | null): string {
  switch (status) {
    case 'AUTHORIZED':
      return 'AUTHORIZED. The bank approved it: safe to fulfil the order (once).';
    case 'FAILED':
      return `FAILED${failureReason === null ? '' : ` (${failureReason})`}. Do not fulfil.`;
    case 'PENDING':
      return (
        'PENDING. The bank has not answered yet; this is not a failure. Do not fulfil yet: wait ' +
        'for the webhook, or call wait_for_payment_result.'
      );
  }
}
