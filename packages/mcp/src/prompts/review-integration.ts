import type { McpServer } from '@modelcontextprotocol/server';
import { userMessage } from './message.js';

const CHECKLIST = `Review this project's Bonum PSP V2 integration. For each item, answer pass, fail or not applicable, cite the files involved, and propose a fix for every failure.

1. The merchant key is used only on the server: never in front-end or app code, bundles, logs, error reports or API responses.
2. Credentials come from the environment or a secret manager, BONUM_ENV is set explicitly, and no real key or secret is committed (check env examples, fixtures and tests).
3. The webhook route reads the raw body; no JSON parser runs on it first.
4. The signature and timestamp are checked before any other work, with bonum-psp or an equivalent constant-time HMAC check, and failures get a 400.
5. The webhook handler answers 2xx within 10 s and does slow work afterwards (store, then process).
6. Idempotency, level 1: a repeated webhookId is detected (e.g. a unique index) and answered with 200.
7. Idempotency, level 2: an order leaves PENDING only once per paymentId (a conditional update), so a retry with a new webhookId cannot fulfil twice.
8. Orders are fulfilled only for AUTHORIZED, and PENDING is never shown to the customer as failed.
9. The amount comes from server-side order data, every attempt uses a new order_id, and the paymentId is stored.
10. Wallet endpoints use one deadline (about 25 s) for the submission plus waitForResult(), and treat timeouts and network errors as an unknown outcome.
11. A reconciliation job looks up payments still PENDING after a few minutes.
12. Logs never contain the merchant key, the webhook secret or wallet tokens.

If the "bonum" MCP server is available, run \`send_test_webhook\` with scenario "all" against the local webhook endpoint and include the results. For production readiness, also go through bonum://checklists/go-live.`;

/** `review_bonum_integration`: an audit checklist for an existing integration. */
export function registerReviewIntegration(server: McpServer): void {
  server.registerPrompt(
    'review_bonum_integration',
    {
      title: 'Review Bonum integration',
      description:
        'Audit an existing Bonum PSP integration: server-side key, raw body, verification ' +
        'first, 2xx within 10 s, both idempotency levels, reconciliation, no secrets in logs.',
    },
    () => userMessage(CHECKLIST),
  );
}
