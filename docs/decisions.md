# Design decisions

**English** | [Монгол](./decisions.mn.md)

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

## D15. Unknown webhook event types are acknowledged

A correctly signed webhook with an `eventType` this SDK does not know throws
`BonumWebhookError('unsupported_event_type')`. The handler helpers answer it with
`200 { "received": true, "ignored": true }`. A 4xx would make Bonum retry an event the merchant can
never handle, until it gives up. The event type is checked before the other fields, because a new
type may well have a different shape. `onError` still sees it, so it shows up in logs.

## D16. Handler errors stay visible

When `onEvent` throws (or verification fails unexpectedly), the handlers call `onError` and answer
500 so Bonum retries. If no `onError` was given, the Fetch handler rethrows and the Express adapter
calls `next(error)`. The framework then logs the error and answers 500. Silently swallowing it would
hide a broken handler until Bonum stops retrying. Rejected webhooks (bad signature, stale timestamp)
always get a 400 that names only the reason.

## D17. Webhook event fields are typed loosely where Bonum may vary

`PaymentAuthorizedEvent` and `PaymentFailedEvent` differ only in `eventType` and `status`.
`providerReference` and `failureReason` are `string | null` on both: a declined payment may still
carry a bank reference, and rejecting a genuine webhook over that would lose the event.
`status` must still equal `eventType` (D3).

## D18. Webhook secret handling

Secrets are trimmed like the merchant key (D13), and an array of secrets supports rotation. Keys are
imported once with Web Crypto and cached; a failed import is retried on the next call.
`toleranceSeconds` defaults to Bonum's 300 and is limited to 1–3600, so replay protection cannot be
switched off by accident. There is no option to skip the timestamp check (see D5).

## D19. Examples run on the toolchain as is

The Express example runs its TypeScript directly with Node's type stripping (Node 22.18 or later),
so it needs no build step. The Next.js example builds with `next build` on TypeScript 7, so no
TypeScript 6 fallback is needed anywhere. Its route handler creates the webhook verifier on the
first request, so `next build` does not need the secret.

## D20. The MCP server is also a small library

Besides the CLI, `bonum-psp-mcp` exports `createBonumMcpServer(deps)` and `depsFromEnv(env)`, so the
server can be embedded (for example over HTTP with the MCP SDK's handlers) and tested in-process.
`deps` can carry everything the CLI reads from the environment: base URL, warnings, the remote-target
switch and the redactor, besides the brief's client, `fetch` and `now`. `webhooks` is a two-method
`WebhookToolkit` (verify and sign) rather than a `BonumWebhooks`, because the test tools sign with the
same secret. The secret stays in a closure. The smoke test speaks both the current MCP handshake and
the legacy one, because clients upgrade at different times.

## D21. The MCP server always starts

`depsFromEnv` never throws. A missing or invalid value switches off only the tools that need it. It
becomes a warning that the CLI prints to stderr at startup, `check_connection` lists, and the
affected tools repeat. `BONUM_ENV` must be exactly `sandbox` or `production`. Anything else falls
back to sandbox with a warning: unlike the SDK, which never guesses, the MCP server is a development
tool, and sandbox is the safe side. `BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS` accepts only `true` and
`false`; any other value warns and stays `false`.

## D22. Shorter API timeouts in the MCP server

The MCP server's client uses a 10 s timeout and one retry, instead of the SDK's 15 s and two. A tool
call then answers within about 20 s, well inside the tool-call limits of common MCP clients.
`wait_for_payment_result` keeps the SDK's own rule: no retry, and an HTTP timeout of `waitMs + 5 s`.

## D23. Tool handlers catch their own errors

The MCP SDK turns an exception into an error result that carries the raw message, which would skip
redaction. Every tool therefore catches errors itself and returns them as `isError` results. All
text and `structuredContent` then pass through the redactor, which replaces the configured key and
secret (longest first) with `[redacted]`. SDK messages never contain secrets in the first place, so
this is the last line of defense. After every test, the MCP suite scans everything the server sent
for the configured key and secret. The test secrets differ from the documentation placeholders,
which the prompts may show legitimately.

## D24. Production results are labelled, errors included

With `BONUM_ENV=production`, the text of every result from a tool that calls Bonum starts with a
production warning, error results included: a 404 from production is live data too. Successful
results also carry `environment` in `structuredContent`. `create_test_webhook` and
`send_test_webhook` refuse to run at all (D4).

## D25. How `send_test_webhook` judges an endpoint

`scenario` defaults to `all`, and `create_test_webhook`'s `eventType` defaults to `AUTHORIZED`, so
"test my webhook" needs nothing but a URL. Scenarios run one after another, so the duplicate pair is
not mixed up with other deliveries. The forged webhook is signed with a fresh random secret, and the
stale one is signed correctly but 10 minutes old (twice the tolerance). A 2xx to either is a
security failure, and the summary opens with it. A 5xx to either is a warning, because Bonum would
retry. A 3xx always fails: the tool does not follow redirects (D4), so the handler never saw the
event.

## D26. Extra output fields

Some MCP tools return more than the brief lists. `verify_webhook` adds `message`, the SDK's
explanation of `reason`. `create_test_webhook` adds `expiresAt`, when the signature leaves the
five-minute window. The payment tools add `normalizedCurrency` next to the unchanged `currency`
(D11). `check_connection` reports `auth` as `ok`, `invalid_key`, `unreachable`, `error` or
`not_configured`, plus the configuration warnings.

## D27. Prompts stand on their own

Some MCP clients support tools and prompts but not resources. Each prompt therefore states the rules
it relies on in its own text, and points to the `bonum://` resources only for further reading.

## D28. TypeScript 7 across the toolchain

TypeScript 7 has no classic compiler API, but nothing in the chain needs it. tsdown generates
declarations through the `isolatedDeclarations` (oxc) path, knip parses with oxc, and attw
analyzes with the TypeScript 5.6 it ships itself. The `expectTypeOf` type tests are checked by the
regular `tsc` run over the test files (`pnpm typecheck`), instead of by Vitest's typecheck mode. No
tool needed a TypeScript 6 fallback (see also D19).

## D29. How the MCP server is tested

The tools are tested in-process through a real MCP `Client`. It talks to the server over the MCP
SDK's HTTP handler (`createMcpHandler`) with an in-process `fetch`, which covers the current
protocol revision. The SDK's in-memory transport only covers the 2025 revisions. The stdio path is
covered by the smoke test, which spawns the built `dist/cli.js` (D20).

## D30. Unexpanded `${VAR}` references are ignored

The recommended `.mcp.json` passes secrets as `${BONUM_MERCHANT_KEY}`. When the variable is unset,
Claude Code hands the literal text to the server, which would then sign with `${…}` as the secret
or call Bonum with it as the key. `depsFromEnv` treats any value containing `${…}` as unset, adds a
warning that names the variable to export, and switches off only the affected tools (D21).

## D31. `branch_id` and the Apple Pay `amount` are optional pass-throughs

The live API reference now lists `branch_id` for both wallets, not only in the integration guide.
The SDK sends it, like `amount`, only when the caller provides it. Bonum's pages show `amount` for
Apple Pay only in examples and never say whether it overrides the amount inside the token. The SDK
sends exactly what the merchant passes, and the docs tell merchants to decide the amount on their
server.

## D32. Release pipeline

Releases use Changesets 3 with `changesets/action` v2, split into its sub-actions as Changesets
recommends for trusted publishing. `select-mode` decides between versioning and publishing.
`version` opens the "Version Packages" pull request (and regenerates `src/version.ts`, D8).
`pack` runs `pnpm check` and packs each package with `pnpm pack`, which rewrites `workspace:^`.
`publish` publishes the packed tarballs with `pnpm publish`. Only `publish` has
`id-token: write`. Changesets 3 detects pnpm and calls `pnpm pack`/`pnpm publish` itself. pnpm 12
is a native executable that performs the OIDC exchange and attaches provenance without the npm
CLI, so the runner's npm version does not matter. Release jobs use no dependency cache and install
with `--ignore-scripts`, which limits what a compromised dependency could do next to an OIDC token.
Every action is pinned to a full commit SHA.

## D33. Files Biome leaves alone

Biome 2.6 also formats Markdown and YAML. Four kinds of files are excluded:

- `CHANGELOG.md` files and `.changeset/*.md`, which Changesets writes and contributors edit,
  because a formatting difference must not fail CI on the Version Packages pull request;
- `skills/**/SKILL.md`, whose YAML front matter Biome would reshape;
- `CODE_OF_CONDUCT.md`, the Contributor Covenant kept verbatim.

Everything else, embedded code blocks in the READMEs included, is formatted and checked.

## D34. Gateway invoices get their own client

Bonum's Gateway API (invoices with a hosted checkout page) differs from PSP V2 in host
(`testapi.bonum.mn` / `apis.bonum.mn`), authentication (an app secret and terminal id exchanged
for a bearer token) and webhook signing. It is therefore a separate `BonumGatewayClient` with its
own `BONUM_GATEWAY_*` variables, sharing only the transport options and HTTP layer with
`BonumClient`. Bonum documents it in a [Postman collection](https://documenter.getpostman.com/view/6164222/2sB2cYbzu8)
rather than on psp.bonum.mn. The rules below were confirmed against the test environment on
2026-10-26.

## D35. Creating an invoice is never retried

Unlike `order_id` in PSP V2 (D10), a repeated `transactionId` is not an idempotency key: Bonum
answers HTTP 409 instead of returning the first invoice. A retry after a lost response could
therefore never succeed, and could hide that the first attempt worked. `invoices.create()` sends
exactly once; its timeout message says the invoice may exist and that its webhook will carry the
`transactionId`. Bonum also answers some invalid input (an unknown provider, a missing field) with
HTTP 500, another reason not to retry. Listing providers is retried as usual.

## D36. No invoice status lookup

Bonum's invoice status endpoint is marked as testing-only, and in the test environment it answers
"DO NOT USE this" (HTTP 400) for every invoice. Bonum tells merchants to rely on their own records
and the webhook. The SDK and the MCP server therefore offer no status call; the docs say so.

## D37. Gateway access tokens

The token endpoint is rate-limited and Bonum asks clients to reuse tokens. `GatewayTokens` caches
one token per client, shares one request between concurrent callers, and renews at the later of
"60 s before expiry" and "half the lifetime", so short-lived tokens are not fetched on every call.
It refreshes with the refresh token while that is valid, and falls back to the app secret when
Bonum rejects the refresh token (a 4xx other than 429). A 401 on an API call drops the access
token and repeats the call once: a 401 means Bonum did not act on it, so this is safe even for
`create()`. Even if a proxy answered 401 after Bonum had created the invoice, the repeat would get
a 409 for the same `transactionId`, never a second invoice. Only the token Bonum rejected is
dropped, so late 401s from concurrent requests do not discard a token that was just renewed. A
caller's abort stops its wait for a token without cancelling the shared token request. Bodies of
token responses, successful or not, are never attached to errors, because they may contain tokens.

## D38. Gateway webhook verification

The `X-Checksum-V2` header is the hex HMAC-SHA256 of the body under the merchant's checksum key.
The SDK checks it over the raw bytes, with the same constant-time Web Crypto verifier as PSP
webhooks. Bonum's sample computes the checksum over the body re-serialized without whitespace, so
if the raw bytes do not match, the compact re-serialization is tried as well; both are keyed MACs,
so this accepts no forgery. These webhooks carry no timestamp, so there is no replay window: the
docs tell merchants to make fulfilment idempotent per `transactionId`. A `type` other than
`PAYMENT` (such as `CARD-TOKEN`) is `unsupported_event_type`, acknowledged like D15. Only `status`
and `body.transactionId` are required; the other fields are `null` when missing, because the paid
and expired samples differ. The webhook's `invoiceId` is not the one `create()` returned, so the
docs match on `transactionId`.

## D39. Invoice validation follows the live API

Checked in the test environment: `amount` must be at least 1 (decimals are accepted, so the SDK
allows two), `transactionId` 1–80 non-blank characters, `expiresIn` at least 1, and `callback`
must be present (an empty string means none). Items need `remark` (the SDK sends `""` by default)
but not `image`. Bonum accepts any text as `callback`, but the SDK requires an absolute `https:` or
`http:` URL, because the browser is sent there. Provider codes must look like `QPAY`, since an
unknown one fails with HTTP 500 rather than a clear error.

## D40. `create_invoice` is the MCP server's first write tool

Invoices are how a merchant gets paid by QPay, so the MCP server can create one. The tool is marked
neither read-only nor idempotent, so clients ask before running it; its description asks the agent
to confirm the amount, and with `BONUM_ENV=production` its output carries the production banner.
`transactionId` is generated (`mcp-<UTC time>-<random>`) when omitted, so a repeated request never
collides. The app secret and checksum key are redacted from every output like the other secrets.
