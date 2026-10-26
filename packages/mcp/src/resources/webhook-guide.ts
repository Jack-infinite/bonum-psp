/** `bonum://guides/webhooks`: receiving, verifying and testing Bonum webhooks. */
export const WEBHOOK_GUIDE: string = `# Bonum PSP V2: webhook guide

Unofficial guide that ships with bonum-psp-mcp. Official documentation:
https://psp.bonum.mn/v2/webhook-guide.html.

## What Bonum sends

- A \`POST\` with a JSON body to the HTTPS URL you registered with Bonum (dashboard or support;
  there is no API for it). Bonum then gives you the webhook signing secret.
- Headers: \`X-PSP-Signature: v1=<hex>\` and \`X-PSP-Timestamp: <Unix seconds>\`.
- Body fields: \`webhookId\`, \`paymentId\`, \`orderId\`, \`eventType\` (\`AUTHORIZED\` or \`FAILED\`),
  \`status\` (same as eventType), \`amount\` (decimal string), \`currency\`, \`providerReference\`,
  \`failureReason\`, \`occurredAt\`, \`walletType\`, \`binCategory\`.
- Your endpoint must answer **2xx within 10 seconds**. Anything else is a failed delivery. Bonum
  tries up to 5 times (at once, then after about 1 min, 5 min, 30 min and 2 h) and then gives up.
  After that, a status lookup recovers the result (Bonum support can also re-send the webhook).

## Verification

The signature is HMAC-SHA256, keyed with the signing secret, over \`<timestamp>.<raw body>\`.
Timestamps more than 300 s from your clock are rejected, which stops replays. \`bonum-psp\` does
all of this, with a constant-time comparison:

\`\`\`ts
const event = await bonum.webhooks.verify(rawBody, headers); // throws BonumWebhookError
\`\`\`

The signature covers the **exact bytes** Bonum sent. Parsing the JSON and serializing it again
changes them, so verification needs the raw body:

| Framework | Raw body |
|---|---|
| Express 5 | \`express.raw({ type: 'application/json' })\` on the webhook route, registered before any global \`express.json()\`; or \`expressWebhookHandler()\` from \`bonum-psp/express\` |
| Next.js App Router | \`export async function POST(request: Request)\` and \`webhooks.createHandler()\` or \`verifyRequest(request)\` |
| Hono | \`app.post('/webhooks/bonum', (c) => handler(c.req.raw))\` |
| Fastify | a \`parseAs: 'buffer'\` content-type parser for \`application/json\`, scoped to the webhook route |
| NestJS | \`NestFactory.create(AppModule, { rawBody: true })\`, then \`req.rawBody\` |
| Workers, Bun, Deno | \`webhooks.createHandler()\`, a Fetch \`(request) => Response\` handler |

## Store, then process

1. Verify the signature before doing anything else. Answer 400 when it fails.
2. Deduplicate (see below). A duplicate gets 200, never a 4xx.
3. Store the event, and answer 200 right away.
4. Do the slow work (emails, fulfilment) afterwards, e.g. from a queue.

## Two levels of idempotency

Bonum documents \`webhookId\` both as unique per delivery attempt and as the dedupe key, so a retry
may arrive with a new \`webhookId\`. Protect yourself twice:

1. A unique index on \`webhookId\` catches the same delivery arriving twice.
2. Apply the status change per \`paymentId\` only once, with a conditional update:

\`\`\`ts
// MongoDB
await webhookEvents.insertOne({ _id: event.webhookId, ...event }); // duplicate key: already seen
await orders.updateOne(
  { paymentId: event.paymentId, status: 'PENDING' }, // only PENDING may change
  { $set: { status: event.status, providerReference: event.providerReference } },
);
// SQL: UPDATE orders SET status = $1 WHERE payment_id = $2 AND status = 'PENDING'
\`\`\`

## Testing locally

1. Run your app, e.g. on http://localhost:3000.
2. Call the \`send_test_webhook\` tool with your endpoint URL and \`scenario: "all"\`. It checks that
   genuine events get 2xx, a repeated delivery gets 2xx, and forged or stale events get 4xx.
3. \`create_test_webhook\` gives you one signed event plus a curl command, for manual tests.
4. To receive real sandbox webhooks, expose your machine through a tunnel (for example
   \`cloudflared tunnel --url http://localhost:3000\`) and ask Bonum to register that HTTPS URL.
5. \`verify_webhook\` explains why a captured body and headers do or do not verify; use
   \`ignoreTimestamp\` for captures older than 5 minutes.

## Troubleshooting a signature mismatch

- The body was parsed before verification (a global JSON parser runs first).
- The secret belongs to the other environment (sandbox and production secrets differ).
- A proxy, CDN or middleware changed the body (compression, re-encoding, pretty-printing).
- The server clock is off: keep it synced with NTP.
`;
