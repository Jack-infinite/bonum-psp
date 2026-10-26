import type { McpServer } from '@modelcontextprotocol/server';
import {
  BonumWebhookError,
  type BonumWebhookErrorReason,
  type InvoicePaymentEvent,
} from 'bonum-psp';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { registerTool, requireGatewayWebhooks, type ToolAnswer } from './tool.js';

const inputSchema = z.object({
  rawBody: z
    .string()
    .describe(
      'The webhook body exactly as received, byte for byte. The checksum covers these bytes.',
    ),
  checksum: z.string().describe('Value of the X-Checksum-V2 header (64 hex characters).'),
});

const eventSchema = z.object({
  type: z.literal('PAYMENT'),
  status: z.enum(['SUCCESS', 'FAILED']),
  transactionId: z.string(),
  invoiceId: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  paymentVendor: z.string().nullable(),
  invoiceStatus: z.string().nullable(),
  completedAt: z.string().nullable(),
  terminalId: z.string().nullable(),
  body: z.record(z.string(), z.unknown()),
});

const outputSchema = z.object({
  valid: z.boolean().describe('Whether bonum-psp accepts this webhook as a genuine event.'),
  reason: z.string().optional().describe('Why not, e.g. "signature_mismatch".'),
  message: z.string().optional().describe('What the reason means and what to check.'),
  event: eventSchema.optional().describe('The verified event, when valid.'),
});

type Output = z.output<typeof outputSchema>;

// Reasons that come after a successful checksum check.
const CHECKSUM_PASSED: ReadonlySet<BonumWebhookErrorReason> = new Set([
  'invalid_payload',
  'unsupported_event_type',
]);

/** `verify_invoice_webhook`: explains why a captured invoice webhook does or does not verify. */
export function registerVerifyInvoiceWebhook(server: McpServer, deps: ResolvedDeps): void {
  registerTool(server, deps, {
    name: 'verify_invoice_webhook',
    title: 'Verify invoice webhook',
    description:
      'Check a captured Bonum Gateway (invoice) webhook, its raw body plus the X-Checksum-V2 ' +
      'header, against the configured checksum key, and explain why it fails. Use it to debug ' +
      'invoice webhooks or to see whether a payment succeeded.',
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    callsBonum: false,
    async run({ rawBody, checksum }) {
      const webhooks = requireGatewayWebhooks(deps);
      try {
        return validAnswer(await webhooks.verify(rawBody, { 'x-checksum-v2': checksum }));
      } catch (error) {
        if (error instanceof BonumWebhookError) return invalidAnswer(error);
        throw error;
      }
    },
  });
}

function validAnswer(event: InvoicePaymentEvent): ToolAnswer<Output> {
  const amount = event.amount === null ? '' : `, ${event.amount} ${event.currency ?? ''}`.trimEnd();
  const outcome =
    event.status === 'SUCCESS'
      ? `paid${event.paymentVendor === null ? '' : ` with ${event.paymentVendor}`}`
      : `failed${event.invoiceStatus === null ? '' : ` (${event.invoiceStatus})`}`;
  return {
    summary:
      `Valid Bonum invoice webhook: ${event.status}, ${outcome}, for transactionId ` +
      `${event.transactionId}${amount}. Check the amount against your order before fulfilling.`,
    data: { valid: true, event },
  };
}

function invalidAnswer(error: BonumWebhookError): ToolAnswer<Output> {
  const checksum = CHECKSUM_PASSED.has(error.reason) ? ' The checksum itself is valid.' : '';
  return {
    summary: `Not valid: ${error.reason}. ${error.message}${checksum}`,
    data: { valid: false, reason: error.reason, message: error.message },
  };
}
