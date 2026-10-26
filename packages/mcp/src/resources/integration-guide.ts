/** `bonum://guides/integration`: the V2 payment flow with `bonum-psp`. */
export const INTEGRATION_GUIDE: string = `# Bonum PSP V2: integration guide

Unofficial guide that ships with bonum-psp-mcp. Official documentation:
https://psp.bonum.mn/v2/integration-guide.html. If the two disagree, the official docs win.

## How a V2 payment works

1. The customer confirms Apple Pay or Google Pay. The wallet gives your app or web page an
   encrypted payment token.
2. The app sends the token to **your backend**. Only the backend talks to Bonum: every API call
   carries the merchant key, a server secret that must never reach a browser or an app.
3. The backend submits the token. Bonum answers at once with \`status: "PENDING"\` and a
   \`paymentId\`. PENDING means "accepted, the bank has not answered yet". It is not a failure.
4. The bank's answer then arrives in two independent ways:
   - a **webhook** to your registered endpoint. This is the source of truth; always handle it.
   - the **await endpoint** (\`waitForResult()\`), which holds the request open for up to 28 s so
     the wallet sheet can show the real outcome. A sheet only knows success and failure: when the
     wait ends with \`PENDING\`, close it with failure (as Bonum's guide does), show "processing"
     and let the webhook settle the order.
5. Fulfil the order only for \`AUTHORIZED\`. A \`FAILED\` payment carries a \`failureReason\`.

## Setup

- Environments: sandbox \`https://testpsp.bonum.mn\`, production \`https://psp.bonum.mn\`. Bonum
  issues a merchant key for each, and a webhook signing secret once your webhook URL is registered.
- Install the SDK on the server: \`npm install bonum-psp\` (Node.js 22.12+, Bun, Deno, Workers).
- Configure it through the environment: \`BONUM_MERCHANT_KEY\`, \`BONUM_WEBHOOK_SECRET\` and
  \`BONUM_ENV\` (\`sandbox\` or \`production\`; the SDK never guesses the environment).

\`\`\`ts
import { BonumClient } from 'bonum-psp';

export const bonum = new BonumClient(); // reads BONUM_MERCHANT_KEY, BONUM_ENV, BONUM_WEBHOOK_SECRET
\`\`\`

## Apple Pay

\`\`\`ts
// The app posts { orderId, token } after the customer authorizes the payment.
const signal = AbortSignal.timeout(25_000); // the wallet sheet stays open for about 30 s
const started = Date.now();
try {
  const submission = await bonum.payments.submitApplePay(
    { orderId: order.id, token, amount: order.amount }, // amount from YOUR database, not the app
    { signal },
  );
  await saveIds(order.id, submission.paymentId);
  const waitMs = Math.max(1, 23_000 - (Date.now() - started));
  const result = await bonum.payments.waitForResult(submission, { waitMs, signal });
  return { status: result.status }; // PENDING: still deciding, show "processing"
} catch (error) {
  if (error instanceof BonumValidationError) return { error: 'invalid_request', field: error.field };
  return { status: 'PENDING' }; // timeout or network error: the outcome is unknown, never "failed"
}
\`\`\`

- \`token\` is Apple's \`PKPaymentToken\` (or its JSON string), exactly as received. Never edit it.
- \`amount\` is optional, in major units (150.5 = 150.50 MNT). The currency comes from the token.

## Google Pay

\`\`\`ts
const submission = await bonum.payments.submitGooglePay({
  orderId: order.id,
  token: paymentData.paymentMethodData.tokenizationData.token, // the string, unchanged
  currency: 'MNT', // MNT, USD, EUR or JPY
  amount: order.amount,
});
const result = await bonum.payments.waitForResult(submission);
\`\`\`

## Order ids and retries

- \`order_id\` is Bonum's idempotency key: submitting an existing one returns the original payment
  instead of charging again. A retry after a timeout or network error is therefore safe, and the
  SDK retries submissions on its own.
- Use a new \`order_id\` for every payment attempt, and store the \`paymentId\` next to the order.

## Reconciliation

Webhooks can be missed: the server was down, or a deploy broke the route. Bonum retries for about
two hours and then stops. Run a periodic job that finds orders still \`PENDING\` after a few
minutes and asks Bonum: \`bonum.payments.get(paymentId)\`, or \`getByOrderId(orderId)\`.

## Statuses

| Status | Meaning | What to do |
|---|---|---|
| PENDING | Accepted, waiting for the bank | Nothing yet; never fulfil |
| AUTHORIZED | Approved by the bank | Fulfil the order, exactly once |
| FAILED | Declined or failed | Show \`failureReason\`; a new attempt needs a new order_id |

## Wallet platform setup

Apple Pay merchant identity and domain verification, and Google Pay merchant setup, are explained
in Bonum's wallet guides, linked from https://psp.bonum.mn/v2/integration-guide.html.

Next: bonum://guides/webhooks.
`;
