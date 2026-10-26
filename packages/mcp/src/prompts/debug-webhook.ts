import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { userMessage } from './message.js';

const argsSchema = z.object({
  symptom: z
    .string()
    .max(2_000)
    .optional()
    .describe('What goes wrong, e.g. "every webhook gets 400 signature_mismatch".'),
});

/** `debug_webhook`: a systematic walk through the usual causes of rejected webhooks. */
export function registerDebugWebhook(server: McpServer): void {
  server.registerPrompt(
    'debug_webhook',
    {
      title: 'Debug Bonum webhook',
      description:
        'Find out why Bonum webhooks fail at your endpoint (signature mismatch, timeouts, ' +
        'retries), checking raw-body handling, secrets, clock skew and proxies with verify_webhook.',
      argsSchema,
    },
    ({ symptom }) => userMessage(instructions(symptom?.trim() || undefined)),
  );
}

function instructions(symptom: string | undefined): string {
  return `Help me debug my Bonum webhook endpoint.

Symptom: ${symptom ?? 'Bonum webhooks are not accepted by my endpoint.'}

Work through the likely causes in this order. For each one, check the code and configuration and say what you found.

1. Raw body. The signature covers the exact bytes Bonum sent. Find every body parser that runs before verification: a global \`express.json()\` or body-parser registered before the webhook route, framework defaults (Fastify, NestJS without \`rawBody: true\`), or code that re-serializes the parsed body. Verification must receive the untouched string or Buffer.
2. Secret and environment. BONUM_WEBHOOK_SECRET must be the signing secret of the environment that sends the webhooks: sandbox and production secrets differ. Look for stray quotes or whitespace in env files.
3. Clock skew. X-PSP-Timestamp must be within 300 s of the server clock, so check NTP. Replaying an old capture fails this check too.
4. Proxies and middleware that change the body or drop the X-PSP-* headers: compression, re-encoding, API gateways, logging middleware that consumes the request stream.
5. Route order. The webhook route must be registered before global JSON parsers, or be excluded from them.
6. The response. Genuine events need a 2xx within 10 s and duplicates a 200; rejected webhooks get a 400. A 5xx or a slow answer makes Bonum retry.

Confirm with the tools of the "bonum" MCP server:
- \`check_connection\`: which environment the server uses, and whether a webhook secret is set.
- \`verify_webhook\`: give it a captured raw body and the X-PSP-Signature and X-PSP-Timestamp values to get the exact failure reason. Set \`ignoreTimestamp\` for captures older than 5 minutes.
- \`send_test_webhook\` with scenario "all" against the local endpoint, before and after the fix.

Finish with the root cause, the fix, and the test results.`;
}
