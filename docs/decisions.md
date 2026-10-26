# Design decisions

Short records of choices that Bonum's documentation leaves open, or where its pages disagree with
each other. Each entry says what we do and why. The official docs are at
<https://psp.bonum.mn/v2/integration-guide.html>.

## D1. Redirects are never followed

Requests use `fetch(..., { redirect: 'manual' })`, and any 3xx (or an opaque redirect) becomes a
`BonumUnexpectedResponseError`. The goal is that a redirect can never carry the `x-merchant-key`
header to another host. We wanted `redirect: 'error'`, but Cloudflare Workers rejects that value
(it only accepts `follow` and `manual`), so `manual` is the portable way to get the same guarantee.

## D2. `getByOrderId` returns exactly one payment

The V2 API reference documents the by-order-id lookup as a single payment object. Bonum's older
wallet guides show an array with several attempts under one order id. When an array arrives, the SDK
throws `BonumUnexpectedResponseError` instead of guessing which attempt counts. The docs tell
merchants to use a new `order_id` for every payment attempt and to store the `paymentId`.

## D3. Strict where money depends on it, lenient elsewhere

- An unknown payment `status` is an error: code that decides whether to ship goods must never see a
  value it does not understand.
- A webhook's `status` must equal its `eventType` (Phase 3).
- A missing `providerReference` or `failureReason` becomes `null`, because some Bonum samples omit
  them.
- `walletType` (and the webhook's `binCategory`) are open string unions, so a wallet Bonum adds later
  breaks neither builds nor webhook handlers.
- `statusUrl` and `awaitUrl` are kept as plain strings. The SDK never calls them; it builds every URL
  from its own base URL and a validated `paymentId`.

## D4. The MCP server will not sign test webhooks for production

With `BONUM_ENV=production`, `create_test_webhook` and `send_test_webhook` refuse to sign. A correctly
signed fake `AUTHORIZED` event could be replayed against a live endpoint for five minutes. This is a
speed bump, not a security boundary (`BONUM_ENV` only selects the API host), so the docs also say to
give the MCP server the sandbox secret only. `send_test_webhook` never follows redirects either, so a
signed body is never re-sent to a host the user did not name.

## D5. `verify_webhook`'s `ignoreTimestamp` pins the clock

Replaying a captured webhook needs to skip the five-minute window. The MCP tool does that by setting
"now" to the header's own timestamp. The SDK therefore has no "skip the time check" option that a
merchant could turn on by mistake.

## D6. Token shapes

The Google Pay token must be a string (`tokenizationData.token`, unchanged); an object is a
validation error. The Apple Pay token may be the `PKPaymentToken` object or its JSON string, because
mobile bridges often deliver a string. Only the top level is checked; the token is sent untouched.
`order_id` is limited to 128 characters for both wallets, although Bonum states the limit only for
Apple Pay: the stricter rule fails fast instead of failing at the bank.

## D7. Deadlines across retries

The defaults (15 s per attempt, 2 retries) can outlast the roughly 30 s a wallet sheet stays open.
Instead of a new option, the caller's `AbortSignal` also cancels the wait between retries, and the
wallet examples use one overall deadline for submit plus `waitForResult`.

## D8. The version string is generated

`scripts/sync-version.mjs` writes `src/version.ts` from each `package.json` during `pnpm build` and
the Changesets version step. The file is committed, and a test fails when it drifts. Runtime code
never reads `package.json`, so the SDK works where there is no file system.

## D9. The sandbox may move real money

Comments in Bonum's wallet samples say the test environment charges the bank transaction. The docs
warn about this, and nothing in this repository's tests or MCP tools submits payments.

## D10. A submission can come back already decided

Bonum treats `order_id` as an idempotency key and returns the existing payment when it is reused.
The docs do not say what status that replay carries, so `PaymentSubmission.status` is typed as any
`PaymentStatus`, not just `PENDING`. Otherwise an automatic retry after a lost response could turn a
successful payment into an error, and the customer might pay twice.

## D11. Numeric amounts and currencies are accepted

The reference documents `amount` and `currency` in lookups as strings, but some Bonum samples show
numbers (`150.5`, `496`). The SDK keeps them typed as `string` and converts a JSON number with
`String()`, which preserves its value. A format change on Bonum's side therefore cannot stop
reconciliation. Values are never otherwise rewritten; `normalizeCurrency()` is opt-in.

## D12. Retries and error classes

Network errors, timeouts, 429, 500, 502, 503 and 504 are retried with full-jitter exponential backoff
(500 ms base, 8 s cap). Other statuses, 501 included, are not. `Retry-After` is honored up to 60 s;
`BonumRateLimitError.retryAfterMs` reports the uncapped value Bonum sent. Statuses without a
dedicated class (403, 409, 422, …) throw the base `BonumAPIError`. `maxRetries` is limited to 0–10 so
a typo cannot keep a request busy for minutes.

## D13. Merchant key hygiene

The merchant key is trimmed, because environment files and secret stores often add a newline. A key
with whitespace or control characters inside is rejected, and the error never contains the key.

## D14. Testing hooks are plain options

`sleep` and `random` are client options documented as testing hooks. Retry tests then run
deterministically without fake timers, and merchants can use the same hooks in their own tests.
