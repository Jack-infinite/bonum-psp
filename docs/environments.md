# Environments: sandbox, production and tests

**English** | [Монгол](./environments.mn.md)

Your code is the same everywhere. Three environment variables decide where it talks to.

## The three variables

| Variable               | What it is                                         | Where it comes from                       |
| ---------------------- | -------------------------------------------------- | ----------------------------------------- |
| `BONUM_ENV`            | `sandbox` for testing, `production` for real money | You choose                                |
| `BONUM_MERCHANT_KEY`   | Your API key, sent as the `x-merchant-key` header  | Bonum, one per environment                |
| `BONUM_WEBHOOK_SECRET` | Verifies that a webhook really came from Bonum     | Bonum, when you register your webhook URL |

`BONUM_ENV` picks the server: `sandbox` is `https://testpsp.bonum.mn`, `production` is
`https://psp.bonum.mn`. There is no default: without it, `new BonumClient()` throws a
`BonumConfigError`, so a missing setting can never send test traffic to production or the other
way round.

**Sandbox and production have different keys and secrets.** Never mix them, and never put a
production secret on a developer machine.

```ts
import { BonumClient } from 'bonum-psp';

const bonum = new BonumClient(); // reads all three variables
```

## Local development (sandbox)

1. Create a `.env` file in your app (for Next.js: `.env.local`):

   ```bash
   BONUM_ENV=sandbox
   BONUM_MERCHANT_KEY=mk_test_example
   BONUM_WEBHOOK_SECRET=test_webhook_secret
   ```

   Replace the placeholders with the sandbox values Bonum gave you.

2. Make sure git ignores it: add `.env` and `.env.*` to `.gitignore` (this repo already does).
3. Load it:
   - Node.js 22+: `node --env-file=.env server.js`
   - Next.js: reads `.env.local` on its own.
4. Bonum can only reach your webhook over HTTPS. To receive webhooks on your laptop, use a tunnel
   and register its URL as your **sandbox** webhook URL; see
   [Local webhook testing through a tunnel](../packages/sdk/README.md#local-webhook-testing-through-a-tunnel).

## Production

Don't upload a `.env` file. Put the production values into your host's secret settings, for
example Vercel → Settings → Environment Variables, or the same page on Railway, Render or Fly.io,
Docker or Kubernetes secrets, or a cloud secret manager:

```bash
BONUM_ENV=production
BONUM_MERCHANT_KEY=<production key from Bonum>
BONUM_WEBHOOK_SECRET=<production webhook secret from Bonum>
```

Register your production webhook URL (HTTPS) with Bonum, and go through the go-live checklist
before the first real payment. The MCP server serves it as `bonum://checklists/go-live`.

The SDK trims the merchant key and the webhook secret, so a trailing newline from a secret manager
does no harm. `BONUM_ENV` must be exactly `sandbox` or `production`.

## Testing

| What you test                     | How                                                                                     | Bonum keys needed?        |
| --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------- |
| Your webhook route, in unit tests | `bonum-psp/testing` creates and signs fake events                                       | No: any fake secret works |
| Your running server, end to end   | MCP tool `send_test_webhook`: "test my webhook at http://localhost:3000/webhooks/bonum" | Sandbox webhook secret    |
| Real API calls                    | `BONUM_ENV=sandbox` with the sandbox merchant key                                       | Sandbox merchant key      |
| This repository                   | `pnpm test`                                                                             | No                        |

A unit test with `bonum-psp/testing`:

```ts
import { createTestWebhookEvent, signTestWebhook } from 'bonum-psp/testing';

const { body, headers } = await signTestWebhook({
  payload: createTestWebhookEvent({ orderId: 'ORD-1001' }),
  secret: 'test_webhook_secret', // the same value your app reads from BONUM_WEBHOOK_SECRET
});
// POST body and headers to your webhook route and expect 200.
```

Bonum's wallet samples suggest that sandbox payments may still charge a real card. Ask Bonum for
test cards before you pay with your own.

## The MCP server

The MCP server reads the same three variables from your MCP client's configuration. Give it
**sandbox values only**: anyone who can talk to your agent could use a production webhook secret
to forge webhooks. See [`packages/mcp/README.md`](../packages/mcp/README.md) for the setup of each
client.

## Try it with the examples

- [`examples/express`](../examples/express): copy `.env.example` to `.env`, fill in your sandbox
  values, then run `pnpm install` at the repository root and `pnpm start` in the example folder.
- [`examples/nextjs-app-router`](../examples/nextjs-app-router): copy `.env.example` to
  `.env.local`, then run `pnpm dev` in the example folder.
