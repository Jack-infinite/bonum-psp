/** `bonum://reference/api`: endpoints, fields, statuses and errors of the V2 API. */
export const API_REFERENCE: string = `# Bonum PSP V2: API quick reference

Unofficial summary that ships with bonum-psp-mcp. Official reference:
https://psp.bonum.mn/v2/api-reference.html.

## Basics

- Base URLs: sandbox \`https://testpsp.bonum.mn\`, production \`https://psp.bonum.mn\`.
- Every request sends \`x-merchant-key: <merchant key>\`; POST bodies are JSON.
- Request bodies use snake_case at the top level; responses use camelCase.

## Endpoints

| Method | Path | bonum-psp | Purpose |
|---|---|---|---|
| POST | \`/api/v2/payment/process\` | \`payments.submitApplePay()\` | Submit an Apple Pay token |
| POST | \`/api/v2/payment/process/google\` | \`payments.submitGooglePay()\` | Submit a Google Pay token |
| GET | \`/api/v2/payments/{paymentId}\` | \`payments.get()\` | Current state by paymentId |
| GET | \`/api/v2/payments/{paymentId}/await?timeoutMs=\` | \`payments.waitForResult()\` | Wait for the bank (default 25000 ms, max 28000) |
| GET | \`/api/v2/payments/lookup/by-order-id?orderId=\` | \`payments.getByOrderId()\` | Current state by your order_id |

## Submitting

| Field | Apple Pay | Google Pay | Notes |
|---|---|---|---|
| \`order_id\` | required | required | Your id, up to 128 characters; reusing one returns the original payment |
| \`token\` | object | string | Apple: the PKPaymentToken as received. Google: \`tokenizationData.token\` as received |
| \`currency_code\` | none | required | \`MNT\`, \`USD\`, \`EUR\` or \`JPY\`; Apple Pay takes the currency from the token |
| \`amount\` | optional | optional | Number in major units, at least 0.01 (bonum-psp also allows at most 2 decimals) |
| \`branch_id\` | optional | optional | 1 to 64 characters |

The answer: \`paymentId\`, \`orderId\`, \`status\` (\`PENDING\` for a new payment), \`acceptedAt\`,
\`statusUrl\` and \`awaitUrl\`. The SDK never calls the two URLs; it builds every URL itself.

## Payment (both lookups)

\`paymentId\`, \`orderId\`, \`amount\` (decimal string such as \`"150.50"\`), \`currency\`,
\`walletType\` (\`APPLE_PAY\` or \`GOOGLE_PAY\`), \`status\`, \`providerReference\` (set when
AUTHORIZED), \`failureReason\` (set when FAILED), \`createdAt\`, \`updatedAt\`.

\`currency\` may come as the alpha code (\`"MNT"\`) or the ISO 4217 number (\`"496"\`): the docs show
both. Compare \`normalizeCurrency(payment.currency)\`, which maps 496, 840, 978 and 392 to MNT, USD,
EUR and JPY.

## Await result

\`paymentId\`, \`status\`, \`failureReason\`, and \`timedOut: true\` when the wait ended first (the
status is then still \`PENDING\`). The SDK always returns \`timedOut\` as a boolean.

## Statuses

- \`PENDING\`: accepted, waiting for the bank. Not a failure. Never fulfil.
- \`AUTHORIZED\`: approved. Safe to fulfil, once.
- \`FAILED\`: declined or failed; see \`failureReason\`.

## Errors

The body looks like \`{ "statusCode": 400, "message": "…" or ["…", "…"], "error": "Bad Request" }\`.

| HTTP | Typical cause | bonum-psp error |
|---|---|---|
| 400 | Missing or invalid field, paymentId not a UUID, missing orderId | \`BonumBadRequestError\` |
| 401 | Missing, invalid or deactivated merchant key | \`BonumAuthenticationError\` |
| 404 | Unknown payment or order, or one of another merchant | \`BonumNotFoundError\` |
| 429 | Rate limited (limits are not published) | \`BonumRateLimitError\` |
| 5xx | Bonum-side failure; support will ask for the paymentId | \`BonumServerError\` |

The SDK retries network errors, timeouts, 429 and 500/502/503/504 with backoff. Submissions are
retried too, which is safe because \`order_id\` is idempotent. \`waitForResult()\` is never retried.
`;
