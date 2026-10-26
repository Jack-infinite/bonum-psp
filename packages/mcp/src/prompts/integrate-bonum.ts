import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { userMessage } from './message.js';

const FRAMEWORKS = ['express', 'nextjs', 'hono', 'fastify', 'nestjs', 'other'] as const;
type Framework = (typeof FRAMEWORKS)[number];

const argsSchema = z.object({
  framework: z
    .enum(FRAMEWORKS)
    .optional()
    .describe('Web framework of the backend. Default: detect it from the project.'),
  wallets: z
    .enum(['apple', 'google', 'both'])
    .optional()
    .describe('Which wallets to support. Default: both.'),
});

const WEBHOOK_ROUTE: Readonly<Record<Framework, string>> = {
  express:
    'Express: mount the route with `express.raw({ type: "application/json" })` and ' +
    '`expressWebhookHandler({ webhooks: bonum.webhooks, onEvent })` from `bonum-psp/express`, ' +
    'registered before any global `express.json()`.',
  nextjs:
    'Next.js App Router: `app/api/webhooks/bonum/route.ts` exports `POST(request)`, which calls ' +
    'a handler from `new BonumWebhooks().createHandler({ onEvent })`. Create the handler on the ' +
    'first request, so `next build` does not need the secret.',
  hono:
    'Hono: `const handler = bonum.webhooks.createHandler({ onEvent })` and ' +
    '`app.post("/webhooks/bonum", (c) => handler(c.req.raw))`.',
  fastify:
    'Fastify: put the route in its own plugin with `addContentTypeParser("application/json", ' +
    '{ parseAs: "buffer" }, (req, body, done) => done(null, body))`, then call ' +
    '`await bonum.webhooks.verify(request.body, request.headers)`.',
  nestjs:
    'NestJS: create the app with `NestFactory.create(AppModule, { rawBody: true })` and call ' +
    '`await bonum.webhooks.verify(req.rawBody, req.headers)` in the webhook controller.',
  other:
    'Detect the framework, and verify the exact raw request bytes: Fetch-style runtimes use ' +
    '`bonum.webhooks.createHandler({ onEvent })`; Node frameworks must keep JSON parsers off the ' +
    'webhook route and pass the raw Buffer to `bonum.webhooks.verify(rawBody, headers)`.',
};

const APPLE_PAY =
  'Apple Pay: the app sends the PKPaymentToken (Apple Pay JS `event.payment.token`, or PassKit ' +
  '`PKPayment.token` as JSON) to the backend, which calls ' +
  '`bonum.payments.submitApplePay({ orderId, token, amount })` with the token unchanged.';
const GOOGLE_PAY =
  'Google Pay: the app sends `paymentData.paymentMethodData.tokenizationData.token` (a string) ' +
  'to the backend, which calls `bonum.payments.submitGooglePay({ orderId, token, currency, ' +
  'amount })` with currency MNT, USD, EUR or JPY.';

/** `integrate_bonum`: step-by-step instructions to add Bonum to the current project. */
export function registerIntegrateBonum(server: McpServer): void {
  server.registerPrompt(
    'integrate_bonum',
    {
      title: 'Integrate Bonum PSP',
      description:
        'Add Bonum PSP V2 payments (Apple Pay, Google Pay, webhooks) to this project with the ' +
        'bonum-psp SDK, then validate the webhook endpoint with send_test_webhook.',
      argsSchema,
    },
    ({ framework = 'other', wallets = 'both' }) => userMessage(instructions(framework, wallets)),
  );
}

function instructions(framework: Framework, wallets: 'apple' | 'google' | 'both'): string {
  const walletSteps = [
    ...(wallets === 'google' ? [] : [APPLE_PAY]),
    ...(wallets === 'apple' ? [] : [GOOGLE_PAY]),
  ];
  return `Integrate Bonum PSP V2 payments into this project with the \`bonum-psp\` SDK.

If your client can read MCP resources, read bonum://guides/integration and bonum://guides/webhooks from the "bonum" server first, and follow them where this message is brief.

1. Install \`bonum-psp\` in the backend. Read BONUM_MERCHANT_KEY, BONUM_WEBHOOK_SECRET and BONUM_ENV from the environment, and list them in the env example file with fake values (mk_test_example, test_webhook_secret, sandbox). Never commit real values.
2. Create one \`BonumClient\` per process: \`new BonumClient()\` reads those variables.
3. Payment endpoint:
${walletSteps.map((step) => `   - ${step}`).join('\n')}
   - The amount comes from the order data on the server, never from the app.
   - Use one deadline of about 25 s for the submission plus \`bonum.payments.waitForResult(submission, { waitMs, signal })\`, then answer the app with the status. A timeout or network error leaves the outcome unknown: answer PENDING, never "failed".
   - Store the paymentId with the order, and use a new order_id for every payment attempt.
4. Webhook endpoint. ${WEBHOOK_ROUTE[framework]}
   - Verify before any other work; rejected webhooks get 400 (the SDK handlers do this).
   - Store, then process: deduplicate on webhookId (a unique index), change an order's status only while it is PENDING (a conditional update per paymentId), answer 2xx within 10 s, and do slow work afterwards.
5. Reconciliation: a periodic job looks up orders still PENDING after a few minutes with \`bonum.payments.get(paymentId)\`.
6. Never log or return the merchant key, the webhook secret or wallet tokens, and keep the merchant key out of front-end code.
7. Validate: start the app, then call the \`send_test_webhook\` tool of the "bonum" MCP server with the local webhook URL (for example http://localhost:3000/webhooks/bonum) and scenario "all". Fix the code until every scenario passes, then summarize what you changed.`;
}
