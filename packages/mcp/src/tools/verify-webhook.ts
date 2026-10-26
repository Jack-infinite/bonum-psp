import type { McpServer } from '@modelcontextprotocol/server';
import { BonumWebhookError, type BonumWebhookErrorReason, type BonumWebhookEvent } from 'bonum-psp';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { registerTool, requireWebhooks, type ToolAnswer } from './tool.js';

const inputSchema = z.object({
  rawBody: z
    .string()
    .describe(
      'The webhook body exactly as received, byte for byte: not re-formatted, re-serialized or ' +
        'trimmed. Whitespace matters, because the signature covers the exact bytes.',
    ),
  signature: z.string().describe('Value of the X-PSP-Signature header, e.g. "v1=5f2b…".'),
  timestamp: z.string().describe('Value of the X-PSP-Timestamp header, in Unix seconds.'),
  ignoreTimestamp: z
    .boolean()
    .default(false)
    .describe(
      'For captured webhooks older than 5 minutes: check the signature as of the moment in the ' +
        'timestamp header instead of now. Never use this to accept live webhooks.',
    ),
});

const eventSchema = z.object({
  webhookId: z.string(),
  paymentId: z.string(),
  orderId: z.string(),
  eventType: z.enum(['AUTHORIZED', 'FAILED']),
  status: z.enum(['AUTHORIZED', 'FAILED']),
  amount: z.string(),
  currency: z.string(),
  providerReference: z.string().nullable(),
  failureReason: z.string().nullable(),
  occurredAt: z.string(),
  walletType: z.string().nullable(),
  binCategory: z.string().nullable(),
});

const outputSchema = z.object({
  valid: z.boolean().describe('Whether bonum-psp accepts this webhook as a genuine event.'),
  reason: z.string().optional().describe('Why not, e.g. "signature_mismatch".'),
  message: z.string().optional().describe('What the reason means and what to check.'),
  event: eventSchema.optional().describe('The verified event, when valid.'),
});

type Output = z.output<typeof outputSchema>;

// Reasons that come after a successful signature check.
const SIGNATURE_PASSED: ReadonlySet<BonumWebhookErrorReason> = new Set([
  'invalid_payload',
  'unsupported_event_type',
]);

/** `verify_webhook`: explains why a captured webhook does or does not verify. */
export function registerVerifyWebhook(server: McpServer, deps: ResolvedDeps): void {
  registerTool(server, deps, {
    name: 'verify_webhook',
    title: 'Verify webhook',
    description:
      'Check a captured Bonum webhook (raw body plus the X-PSP-Signature and X-PSP-Timestamp ' +
      'headers) against the configured signing secret, and explain exactly why it fails. Use it ' +
      'to debug "signature mismatch" errors, or to inspect a webhook from your logs.',
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    callsBonum: false,
    async run({ rawBody, signature, timestamp, ignoreTimestamp }) {
      const webhooks = requireWebhooks(deps);
      const headers = { 'x-psp-signature': signature, 'x-psp-timestamp': timestamp };
      const pinned = ignoreTimestamp && /^\d+$/.test(timestamp.trim());
      try {
        const event = await webhooks.verify(
          rawBody,
          headers,
          pinned ? Number(timestamp.trim()) : undefined,
        );
        return validAnswer(event, pinned);
      } catch (error) {
        if (error instanceof BonumWebhookError) return invalidAnswer(error);
        throw error;
      }
    },
  });
}

function validAnswer(event: BonumWebhookEvent, pinned: boolean): ToolAnswer<Output> {
  const replay = pinned ? ' (timestamp check skipped: verified as of the header timestamp)' : '';
  return {
    summary:
      `Valid Bonum webhook${replay}: ${event.eventType} for order ${event.orderId}, payment ` +
      `${event.paymentId}, ${event.amount} ${event.currency}. webhookId ${event.webhookId}.`,
    data: { valid: true, event },
  };
}

function invalidAnswer(error: BonumWebhookError): ToolAnswer<Output> {
  const signature = SIGNATURE_PASSED.has(error.reason) ? ' The signature itself is valid.' : '';
  const tip =
    error.reason === 'signature_mismatch'
      ? ' Make sure rawBody is byte-exact (no pretty-printing, no added or removed whitespace or ' +
        'trailing newline) and that BONUM_WEBHOOK_SECRET belongs to the environment that sent it.'
      : '';
  return {
    summary: `Not valid: ${error.reason}. ${error.message}${signature}${tip}`,
    data: { valid: false, reason: error.reason, message: error.message },
  };
}
