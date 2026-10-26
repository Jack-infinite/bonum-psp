import type { McpServer } from '@modelcontextprotocol/server';
import { createTestWebhookEvent, type SignedTestWebhook } from 'bonum-psp/testing';
import { z } from 'zod';
import type { ResolvedDeps } from '../deps.js';
import { paymentIdSchema } from './schemas.js';
import {
  assertSandbox,
  DEFAULT_WEBHOOK_URL,
  nowSeconds,
  testAmountSchema,
  testOrderIdSchema,
} from './test-webhooks.js';
import { registerTool, requireWebhooks } from './tool.js';

// Bonum's replay window: the signature is rejected once the timestamp is this old.
const VALID_FOR_SECONDS = 300;

const inputSchema = z.object({
  eventType: z
    .enum(['AUTHORIZED', 'FAILED'])
    .default('AUTHORIZED')
    .describe('AUTHORIZED (the bank approved) or FAILED (declined).'),
  orderId: testOrderIdSchema,
  paymentId: paymentIdSchema
    .optional()
    .describe('paymentId for the event. Default: a random UUID.'),
  amount: testAmountSchema,
  currency: z.string().min(1).max(8).optional().describe('Currency code. Default "MNT".'),
  walletType: z.enum(['APPLE_PAY', 'GOOGLE_PAY']).optional().describe('Wallet. Default APPLE_PAY.'),
  failureReason: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('For FAILED events. Default: a test reason.'),
  url: z
    .url({ protocol: /^https?$/ })
    .optional()
    .describe(`Endpoint for the curl command. Default ${DEFAULT_WEBHOOK_URL}.`),
});

const outputSchema = z.object({
  body: z.string().describe('The exact JSON body that was signed. Send it unchanged.'),
  headers: z.object({
    'content-type': z.string(),
    'x-psp-signature': z.string(),
    'x-psp-timestamp': z.string(),
  }),
  curl: z.string().describe('A ready-to-run curl command (POSIX shell quoting).'),
  expiresAt: z.string().describe('When the timestamp leaves the 5-minute window (ISO 8601).'),
});

/** `create_test_webhook`: a signed sample webhook plus a curl command to send it. */
export function registerCreateTestWebhook(server: McpServer, deps: ResolvedDeps): void {
  registerTool(server, deps, {
    name: 'create_test_webhook',
    title: 'Create test webhook',
    description:
      'Create a realistic Bonum webhook (AUTHORIZED or FAILED), signed with the configured ' +
      'sandbox secret, plus a curl command to send it to your endpoint. Use it to test a webhook ' +
      'handler by hand or in a script; send_test_webhook runs the full check automatically.',
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
    callsBonum: false,
    async run({ url = DEFAULT_WEBHOOK_URL, ...fields }) {
      assertSandbox(deps);
      const timestamp = nowSeconds(deps);
      const event = createTestWebhookEvent(fields);
      const signed = await requireWebhooks(deps).sign(JSON.stringify(event), timestamp);
      const expiresAt = new Date((timestamp + VALID_FOR_SECONDS) * 1000).toISOString();
      const curl = curlCommand(url, signed);
      const summary =
        `Signed test ${event.eventType} webhook for order ${event.orderId} (payment ` +
        `${event.paymentId}). The signature is accepted for 5 minutes, until ${expiresAt}; ` +
        `create a new one after that.\n\n${curl}`;
      return { summary, data: { ...signed, curl, expiresAt } };
    },
  });
}

function curlCommand(url: string, { body, headers }: SignedTestWebhook): string {
  return [
    `curl -sS -i -X POST ${shellQuote(url)}`,
    ...Object.entries(headers).map(([name, value]) => `-H ${shellQuote(`${name}: ${value}`)}`),
    `--data-raw ${shellQuote(body)}`,
  ].join(' \\\n  ');
}

// POSIX single quotes keep everything literal except the quote itself.
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
