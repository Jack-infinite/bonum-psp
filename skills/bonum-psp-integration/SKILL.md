---
name: bonum-psp-integration
description: Integrate Bonum PSP V2 payments into a server-side TypeScript or JavaScript project with the unofficial bonum-psp SDK. Covers Apple Pay and Google Pay submission through Bonum, waiting for the bank's answer, verifying Bonum webhooks (X-PSP-Signature, X-PSP-Timestamp), idempotent fulfilment and reconciling stuck PENDING payments. Use when the user mentions Bonum, Bonum PSP, psp.bonum.mn or testpsp.bonum.mn, Apple Pay or Google Pay through Bonum, Bonum webhooks or merchant keys, or wallet payments in Mongolia (MNT) via Bonum. Also use to review or debug an existing Bonum integration.
license: MIT
---

# Bonum PSP V2 integration

Integrate with the `bonum-psp` npm package, an unofficial SDK that is not affiliated with BONUM LLC.
It is server-side only and has zero runtime dependencies. Bonum's official docs:
<https://psp.bonum.mn/v2/integration-guide.html>. SDK reference:
<https://github.com/Jack-infinite/bonum-psp/tree/main/packages/sdk#readme>.

## How V2 works

1. The app or web page gets a wallet token from the Apple Pay or Google Pay sheet and sends it to
   **the merchant's backend**.
2. The backend submits it to Bonum. Bonum answers `PENDING` at once. That is **not a failure**; the
   bank has not answered yet.
3. The bank's answer arrives two ways, in parallel:
   - `bonum.payments.waitForResult()` long-polls for up to 28 s. Use it to close the wallet sheet.
   - A **signed webhook** arrives, which Bonum retries up to 5 times (right away, then after about
     1 min, 5 min, 30 min and 2 h).
4. Statuses: `PENDING` (never fulfil), `AUTHORIZED` (fulfil once), `FAILED` (show
   `failureReason`).

## Non-negotiables

Check every change against this list:

1. **The merchant key stays on the server.** Never put it in front-end code, mobile apps, logs or
   chat. Bonum's own JS samples call the API from the browser; never copy that pattern.
2. **Webhooks are verified from the raw body.** Use the exact bytes, never a parsed object. In
   Express, mount the webhook route with `express.raw()` **before** any app-wide `express.json()`.
3. **Verify before doing anything else.** Rejected webhooks get 400 with no details.
4. **Answer 2xx within 10 seconds.** Store the event, answer, and do slow work (emails,
   fulfilment) in the background. Duplicates get 200, never 4xx.
5. **Two levels of idempotency:**
   - a unique index on `webhookId`, so the same delivery is processed once;
   - a conditional update per payment, so a payment leaves `PENDING` once: `UPDATE … SET status = $1
     WHERE payment_id = $2 AND status = 'PENDING'`, and fulfil only if a row changed. Bonum does not
     say whether a retry keeps its `webhookId`, and `waitForResult`, the webhook and lookups can
     all deliver the same answer.
6. **Wallet sheets use `waitForResult` within one deadline.** Use about 25 s for submit plus
   wait, inside the roughly 30 s a sheet stays open. A timeout or network error means "outcome
   unknown": keep the order PENDING and never tell the customer it failed.
7. **Reconcile stuck payments.** A scheduled job looks up orders still `PENDING` after a few
   minutes (`payments.get(paymentId)` or `payments.getByOrderId(orderId)`) and applies the same
   conditional update.

Also:

- The backend decides the amount. Never trust an amount sent by the app.
- Use a new `order_id` for every payment attempt (1–128 characters). Re-submitting the same one
  returns the original payment. That is why the SDK may retry submissions safely.
- Set `BONUM_ENV` explicitly; the SDK refuses to guess. Sandbox is `testpsp.bonum.mn`, production
  is `psp.bonum.mn`, and each has its own key and webhook secret.
- Never ask the user to paste real keys or secrets into the conversation. Put fake values in the
  env example file: `mk_test_example`, `test_webhook_secret`.

## Setup

```bash
npm install bonum-psp   # or pnpm add / yarn add / bun add
```

```bash
# .env.example — real values live in the deployment's secret store
BONUM_ENV=sandbox
BONUM_MERCHANT_KEY=mk_test_example
BONUM_WEBHOOK_SECRET=test_webhook_secret
```

`new BonumClient()` reads these three variables. `new BonumWebhooks()` needs only
`BONUM_WEBHOOK_SECRET`. Node 22.12+ (also Bun, Deno, Cloudflare Workers, Vercel Edge).

## Express 5

```ts
import {
  type ApplePayPaymentToken,
  BonumClient,
  BonumValidationError,
  isBonumError,
} from 'bonum-psp';
import { expressWebhookHandler } from 'bonum-psp/express';
import express from 'express';

const bonum = new BonumClient();
const app = express();

// Webhook first, with the raw body. A global express.json() before it breaks the signature check.
app.post(
  '/webhooks/bonum',
  express.raw({ type: 'application/json' }),
  expressWebhookHandler({
    webhooks: bonum.webhooks,
    onEvent: (event) => saveEvent(event), // fast: dedupe + store + conditional update, then return
  }),
);

app.use(express.json());

app.post('/payments/apple-pay', async (req, res) => {
  const { orderId, token } = req.body as { orderId: string; token: ApplePayPaymentToken | string };
  const order = await findOrder(orderId); // amount from your database, never from the app
  if (order === undefined) {
    res.status(404).json({ error: 'unknown_order' });
    return;
  }
  const deadline = Date.now() + 25_000;
  const signal = AbortSignal.timeout(25_000);
  try {
    const submission = await bonum.payments.submitApplePay(
      { orderId: order.id, token, amount: order.amount },
      { signal, timeoutMs: 8_000 },
    );
    await savePaymentId(order.id, submission.paymentId);
    const waitMs = Math.max(1, Math.min(20_000, deadline - Date.now() - 2_000));
    const result = await bonum.payments.waitForResult(submission, { waitMs, signal });
    res.json({ status: result.status, failureReason: result.failureReason });
  } catch (error) {
    if (error instanceof BonumValidationError) {
      res.status(400).json({ error: 'invalid_request', field: error.field });
      return;
    }
    console.error('Bonum submission problem:', isBonumError(error) ? error.code : error);
    res.status(202).json({ status: 'PENDING' }); // unknown outcome: the webhook will settle it
  }
});
```

Google Pay is the same, with `bonum.payments.submitGooglePay({ orderId, token, currency, amount })`.
The `token` is the string `paymentData.paymentMethodData.tokenizationData.token`, and `currency` is
one of `MNT`, `USD`, `EUR`, `JPY`. For Apple Pay, pass the `PKPaymentToken` object (or its JSON
string) unchanged. Never re-case or rebuild its keys.

## Next.js App Router

```ts
// app/api/webhooks/bonum/route.ts
import { BonumWebhooks } from 'bonum-psp';
import { saveEvent } from '@/lib/bonum-events';

let handler: ((request: Request) => Promise<Response>) | undefined;

export function POST(request: Request): Promise<Response> {
  // Created on first use, so `next build` runs without BONUM_WEBHOOK_SECRET.
  handler ??= new BonumWebhooks().createHandler({ onEvent: saveEvent });
  return handler(request);
}
```

```ts
// app/api/payments/google-pay/route.ts
import { BonumClient } from 'bonum-psp';
import { findOrder, savePaymentId } from '@/lib/orders';

let bonum: BonumClient | undefined;

export async function POST(request: Request): Promise<Response> {
  bonum ??= new BonumClient(); // lazy for the same reason
  const { orderId, token } = (await request.json()) as { orderId: string; token: string };
  const order = await findOrder(orderId);
  if (order === undefined) return Response.json({ error: 'unknown_order' }, { status: 404 });
  const signal = AbortSignal.timeout(25_000);
  try {
    const submission = await bonum.payments.submitGooglePay(
      { orderId: order.id, token, currency: 'MNT', amount: order.amount },
      { signal, timeoutMs: 8_000 },
    );
    await savePaymentId(order.id, submission.paymentId);
    const result = await bonum.payments.waitForResult(submission, { waitMs: 15_000, signal });
    return Response.json({ status: result.status, failureReason: result.failureReason });
  } catch {
    return Response.json({ status: 'PENDING' }, { status: 202 }); // never "failed" when unsure
  }
}
```

The handler from `createHandler()` answers 405 to non-POST requests and 400 to webhooks that fail
verification. It answers 500 when `onEvent` throws, so Bonum retries, and 200 otherwise. Correctly
signed events of an unknown type also get 200, so Bonum stops retrying them.

## Other frameworks

- **Hono / Cloudflare Workers / Bun / Deno:** use
  `const handler = new BonumWebhooks({ secret }).createHandler({ onEvent })`, then
  `app.post('/webhooks/bonum', (c) => handler(c.req.raw))`. On Workers, pass the secret from
  `c.env`.
- **Fastify:** in a plugin scope for the webhook route, call
  `addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))`,
  then `await webhooks.verify(request.body as Buffer, request.headers)`.
- **NestJS:** use `NestFactory.create(AppModule, { rawBody: true })`, then
  `await webhooks.verify(req.rawBody, req.headers)` in a controller with `@HttpCode(200)`.
- **Errors:** for `BonumWebhookError`, answer 400 `{ error: error.reason }`. If `reason` is
  `unsupported_event_type`, answer 200 instead. Rethrow other errors, so the answer is a 500.

## Storing events

```ts
// saveEvent(event): event.webhookId, paymentId, orderId, eventType/status, amount (string), currency
// 1. INSERT INTO bonum_webhook_events (webhook_id, …): on a unique violation, return (duplicate)
// 2. UPDATE orders SET status = event.status WHERE payment_id = event.paymentId AND status = 'PENDING'
// 3. If a row changed and status is AUTHORIZED, enqueue fulfilment; return quickly
```

With MongoDB, use a unique index on `webhookId` and
`updateOne({ paymentId, status: 'PENDING' }, { $set: { status } })`, then check `modifiedCount`.
Keep `amount` as the decimal string Bonum sends. `currency` may be numeric (`"496"`) in lookups;
`normalizeCurrency()` maps it to `"MNT"`.

## Validate the integration

1. **Unit tests** with `bonum-psp/testing`:
   `signTestWebhook({ payload: createTestWebhookEvent({ orderId }), secret: 'test_webhook_secret' })`
   returns `{ body, headers }`. POST them to the handler and expect 200. Then tamper with the
   body and expect 400.
2. **If the `bonum` MCP server is available** (tools such as `check_connection` and
   `send_test_webhook`):
   - run `check_connection` to see the environment and which credentials are set;
   - start the app locally and run `send_test_webhook` with the local webhook URL (for example
     `http://localhost:3000/webhooks/bonum`). Every scenario must pass. A **security failure**
     (a forged or stale webhook got a 2xx) must be fixed before anything else;
   - when a real webhook is rejected, run `verify_webhook` on the logged raw body and headers to
     get the exact reason.
3. **Sandbox end to end:** expose the app over HTTPS (for example `cloudflared tunnel --url
   http://localhost:3000`) and register the URL with Bonum as the sandbox webhook. Bonum's samples
   suggest sandbox payments may charge a real card, so confirm with Bonum before testing with a
   real card.

## Common mistakes

| Symptom                                 | Cause                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `body_not_raw` or `signature_mismatch`  | A JSON parser ran before verification; or a proxy rewrote the body.        |
| `signature_mismatch` everywhere         | The secret belongs to the other environment (sandbox vs production).       |
| `timestamp_out_of_tolerance`            | Server clock off by more than 300 s; sync with NTP.                        |
| Orders marked failed that later succeed | `PENDING` or a timeout was treated as a failure.                           |
| Double fulfilment                       | Dedupe on `webhookId` only, without the conditional status update.         |
| Orders stuck in `PENDING`               | No reconciliation job, or webhook deliveries returned non-2xx.             |
| 401 from Bonum                          | Missing or wrong `BONUM_MERCHANT_KEY`, or a key for the other environment. |

## Before you finish

- [ ] The key and secret come from environment variables; fake values only in examples.
- [ ] The webhook route verifies the raw body before any work and answers within 10 s.
- [ ] Both idempotency levels, and a reconciliation job, are in place.
- [ ] The amount comes from the backend; each attempt uses a new `order_id`.
- [ ] Tests cover a valid, a tampered and a duplicate webhook. `send_test_webhook` passes if the
  MCP server is available.
