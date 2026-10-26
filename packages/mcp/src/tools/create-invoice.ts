import type { McpServer } from '@modelcontextprotocol/server';
import type { CreateInvoiceParams } from 'bonum-psp';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { registerTool, requireGateway } from './tool.js';

const DEFAULT_EXPIRES_IN = 3_600;

const itemSchema = z.object({
  title: z.string().min(1).describe('Product name shown on the checkout page.'),
  amount: z.number().min(0).describe('Unit price in MNT.'),
  count: z.number().int().min(1).describe('Quantity.'),
  remark: z.string().optional().describe('Short note under the title.'),
});

const inputSchema = z.object({
  amount: z.number().min(1).describe('Amount to charge in MNT (major units), e.g. 5000.'),
  transactionId: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe(
      'Your unique id for this invoice (1–80 characters), e.g. the order id plus an attempt ' +
        'number. Webhooks carry it back. Must never repeat; one is generated when omitted.',
    ),
  expiresIn: z
    .number()
    .int()
    .min(1)
    .default(DEFAULT_EXPIRES_IN)
    .describe('Seconds until the invoice expires. Default 3600 (one hour).'),
  callbackUrl: z
    .string()
    .optional()
    .describe('Where the browser returns after payment or expiry (https: URL).'),
  providers: z
    .array(z.string())
    .optional()
    .describe(
      'Limit the checkout page to these payment methods, e.g. ["QPAY"]. Default: all enabled ones ' +
        '(see list_payment_providers).',
    ),
  items: z.array(itemSchema).optional().describe('Lines to show on the checkout page.'),
  language: z.enum(['mn', 'en']).optional().describe('Checkout page language. Default: Mongolian.'),
});

const outputSchema = z.object({
  environment: z.enum(['sandbox', 'production']).describe('The Bonum environment of the invoice.'),
  invoiceId: z.string(),
  followUpLink: z.string().describe('The checkout page to send the customer to.'),
  transactionId: z.string().describe('Matches the webhook Bonum sends when the invoice is paid.'),
  amount: z.number(),
  expiresAt: z.string().describe('When the invoice expires (ISO 8601, from this server clock).'),
});

/** `create_invoice`: creates a Bonum checkout invoice and returns its payment link. */
export function registerCreateInvoice(server: McpServer, deps: ResolvedDeps): void {
  registerTool(server, deps, {
    name: 'create_invoice',
    title: 'Create invoice',
    description:
      'Create a Bonum invoice and get its checkout link (https://ecommerce.bonum.mn/ecommerce?invoiceId=…), ' +
      'where the customer pays with QPay, a card or another enabled method. Confirm the amount ' +
      'with the user first: with BONUM_ENV=production this is a real invoice. Whether it was paid ' +
      'arrives only by webhook; Bonum offers no status lookup for invoices.',
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    callsBonum: true,
    async run(input, signal) {
      const gateway = requireGateway(deps);
      const params: CreateInvoiceParams = {
        ...input,
        transactionId: input.transactionId ?? generateTransactionId(deps.now()),
      };
      const invoice = await gateway.invoices.create(params, { signal });
      const expiresAt = new Date(deps.now() + input.expiresIn * 1000).toISOString();
      return {
        summary: [
          `Created an invoice for ${input.amount} MNT in ${deps.environment}.`,
          `Payment link: ${invoice.followUpLink}`,
          `transactionId ${invoice.transactionId}, invoiceId ${invoice.invoiceId}; expires ${expiresAt}.`,
          'Bonum reports the result only by webhook (to the URL registered in the merchant ' +
            'portal), matched by transactionId. Fulfil only after a verified SUCCESS webhook.',
        ].join('\n'),
        data: { environment: deps.environment, ...invoice, amount: input.amount, expiresAt },
      };
    },
  });
}

// Sortable and unique enough for invoices made by hand: "mcp-20261026114500-1a2b3c4d".
function generateTransactionId(nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/\D/g, '').slice(0, 14);
  return `mcp-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}
