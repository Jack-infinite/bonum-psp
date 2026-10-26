# bonum-psp-mcp

**English** | [Монгол](https://github.com/Jack-infinite/bonum-psp/blob/main/packages/mcp/README.mn.md)

[![npm](https://img.shields.io/npm/v/bonum-psp-mcp)](https://www.npmjs.com/package/bonum-psp-mcp)
[![CI](https://github.com/Jack-infinite/bonum-psp/actions/workflows/ci.yml/badge.svg)](https://github.com/Jack-infinite/bonum-psp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/bonum-psp-mcp)](./LICENSE)

An [MCP](https://modelcontextprotocol.io) server for **Bonum PSP V2**. It lets your AI coding agent
check payments, explain why a webhook was rejected, and test your webhook endpoint with genuine,
forged, stale and duplicate webhooks. It works with Claude Code, Codex, Cursor, Claude Desktop,
VS Code and any other MCP client. The server is the same everywhere; only the config differs.

It cannot submit payments: wallet tokens only come from a real device. To build the integration,
use the [`bonum-psp`](https://github.com/Jack-infinite/bonum-psp/tree/main/packages/sdk) SDK.

- [Quick start](#quick-start) · [Setup per client](#setup-per-client) ·
  [Configuration](#configuration) · [Tools](#tools) · [Resources and prompts](#resources-and-prompts)
- [Example requests](#example-requests) · [Safety model](#safety-model) · [Debugging](#debugging) ·
  [Use as a library](#use-as-a-library)

## Quick start

You need Node.js 22.12 or later. Add the server to Claude Code with your **sandbox** credentials:

```bash
claude mcp add --env BONUM_MERCHANT_KEY=... --env BONUM_WEBHOOK_SECRET=... --env BONUM_ENV=sandbox \
  --transport stdio bonum -- npx -y bonum-psp-mcp
```

Then ask: _"Check my Bonum connection."_

Every variable is optional. Without a merchant key, the payment tools explain how to set one; the
webhook tools still work. Without a webhook secret, it is the other way round.

## Setup per client

Give the MCP server **sandbox credentials only**. See the [safety model](#safety-model) for why.

### Claude Code

```bash
claude mcp add --env BONUM_MERCHANT_KEY=... --env BONUM_WEBHOOK_SECRET=... --env BONUM_ENV=sandbox \
  --transport stdio bonum -- npx -y bonum-psp-mcp
```

- By default the server is added for the current project and only for you (`--scope local`). Add
  `--scope user` to use it in all your projects.
- Keep another option (here `--transport stdio`) between the last `--env` and the name `bonum`.
  Otherwise the CLI reads the name as one more `KEY=value` pair.
- Run `/mcp` inside Claude Code to see the server's status and tools.

### Claude Code: team setup with `.mcp.json`

Commit this `.mcp.json` to the project root. Each developer keeps their own secrets in their shell
environment:

```json
{
  "mcpServers": {
    "bonum": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "bonum-psp-mcp"],
      "env": {
        "BONUM_MERCHANT_KEY": "${BONUM_MERCHANT_KEY}",
        "BONUM_WEBHOOK_SECRET": "${BONUM_WEBHOOK_SECRET}",
        "BONUM_ENV": "${BONUM_ENV:-sandbox}"
      }
    }
  }
}
```

Claude Code fills in `${VAR}` from the environment it was started in, and asks each developer to
approve project servers before first use. If a variable is unset, Claude Code passes the literal
`${VAR}` text. The server recognizes that, ignores the value, and `check_connection` tells you which
variable to export. Don't use `claude mcp add --scope project` for secrets: it writes the values
into `.mcp.json`.

### Codex

The Codex CLI, IDE extension and app share one configuration:

```bash
codex mcp add bonum --env BONUM_MERCHANT_KEY=... --env BONUM_WEBHOOK_SECRET=... --env BONUM_ENV=sandbox -- npx -y bonum-psp-mcp
```

That command stores the values in `~/.codex/config.toml`. To keep secrets out of the file, edit
`~/.codex/config.toml` (or `.codex/config.toml` in a trusted project) instead, and forward them from
your shell:

```toml
[mcp_servers.bonum]
command = "npx"
args = ["-y", "bonum-psp-mcp"]
env_vars = ["BONUM_MERCHANT_KEY", "BONUM_WEBHOOK_SECRET"]  # forwarded from your shell
default_tools_approval_mode = "writes"                     # read-only tools run without prompts

[mcp_servers.bonum.env]
BONUM_ENV = "sandbox"
```

With `"writes"`, Codex asks before tools that are not marked read-only. Here that is only
`send_test_webhook`, which sends requests to your endpoint.

### Claude Desktop

Open **Settings → Developer → Edit Config**, or edit `claude_desktop_config.json` directly
(`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows):

```json
{
  "mcpServers": {
    "bonum": {
      "command": "npx",
      "args": ["-y", "bonum-psp-mcp"],
      "env": {
        "BONUM_MERCHANT_KEY": "mk_test_example",
        "BONUM_WEBHOOK_SECRET": "test_webhook_secret",
        "BONUM_ENV": "sandbox"
      }
    }
  }
}
```

Replace the placeholders with your sandbox values; Claude Desktop does not expand variables. Restart
Claude Desktop afterwards. If it cannot find `npx` (common with nvm), use the absolute path from
`which npx` as the `command`.

### Cursor

Use `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project. Cursor reads
`${env:NAME}` from your environment:

```json
{
  "mcpServers": {
    "bonum": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "bonum-psp-mcp"],
      "env": {
        "BONUM_MERCHANT_KEY": "${env:BONUM_MERCHANT_KEY}",
        "BONUM_WEBHOOK_SECRET": "${env:BONUM_WEBHOOK_SECRET}",
        "BONUM_ENV": "sandbox"
      }
    }
  }
}
```

### VS Code

VS Code's `.vscode/mcp.json` uses `servers` rather than `mcpServers`. It can prompt for secrets once
and store them securely:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "bonum-merchant-key",
      "description": "Bonum sandbox merchant key",
      "password": true
    },
    {
      "type": "promptString",
      "id": "bonum-webhook-secret",
      "description": "Bonum sandbox webhook secret",
      "password": true
    }
  ],
  "servers": {
    "bonum": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "bonum-psp-mcp"],
      "env": {
        "BONUM_MERCHANT_KEY": "${input:bonum-merchant-key}",
        "BONUM_WEBHOOK_SECRET": "${input:bonum-webhook-secret}",
        "BONUM_ENV": "sandbox"
      }
    }
  }
}
```

### Any other MCP client

Run `npx -y bonum-psp-mcp` as a stdio server, with the environment variables below. Or install it
once with `npm install -g bonum-psp-mcp` and run `bonum-psp-mcp`.

## Configuration

| Variable                                 | Needed for                                                                        | Default   |
| ---------------------------------------- | --------------------------------------------------------------------------------- | --------- |
| `BONUM_MERCHANT_KEY`                     | The payment tools (`check_connection`, `get_payment*`, `wait_for_payment_result`) | —         |
| `BONUM_WEBHOOK_SECRET`                   | The webhook tools (`verify_webhook`, `create_test_webhook`, `send_test_webhook`)  | —         |
| `BONUM_ENV`                              | Which Bonum API the payment tools call: `sandbox` or `production`                 | `sandbox` |
| `BONUM_BASE_URL`                         | A proxy in front of Bonum's API (`https:`, or `http:` for localhost)              | —         |
| `BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS` | Letting `send_test_webhook` reach hosts other than local ones                     | `false`   |

The server always starts. A missing or invalid value switches off only the tools that need it, and
those tools explain what to set. `check_connection` lists every configuration warning, and the
server prints them to stderr at startup. Values are trimmed, and are never printed.

## Tools

| Tool                      | What it does                                                                                                                                                                                                   | Needs  | Hints                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------- |
| `check_connection`        | Shows the environment, base URL and which credentials are set (yes/no only). Proves the key works by looking up a random payment id: Bonum answers 404 for a valid key and 401 for an invalid one. Start here. | —      | read-only, idempotent        |
| `get_payment`             | Gets a payment by Bonum `paymentId` (UUID), with `isTerminal` and a normalized currency.                                                                                                                       | key    | read-only, idempotent        |
| `get_payment_by_order_id` | The same, by your `order_id`.                                                                                                                                                                                  | key    | read-only, idempotent        |
| `wait_for_payment_result` | Waits up to `waitMs` (1–28 000, default 25 000) for the bank's answer to a PENDING payment.                                                                                                                    | key    | read-only                    |
| `verify_webhook`          | Checks a captured webhook (exact raw body, `X-PSP-Signature`, `X-PSP-Timestamp`) and explains any failure. `ignoreTimestamp` replays old captures.                                                             | secret | read-only, idempotent, local |
| `create_test_webhook`     | Signs a realistic AUTHORIZED or FAILED webhook and returns the body, headers and a ready `curl` command. The signature is valid for 5 minutes.                                                                 | secret | read-only, local             |
| `send_test_webhook`       | Sends test webhooks to your endpoint and grades each answer. Scenarios: `authorized`, `failed`, `duplicate`, `invalid_signature`, `stale_timestamp` or `all` (default).                                        | secret | sends requests, local        |

`send_test_webhook` expects a 2xx for genuine events, for both copies of a duplicate, and a 4xx for
the forged and the 10-minute-old webhook. A 2xx for either of those is reported as a **security
failure**: anyone could fake a payment. A 5xx where a 4xx is expected is a warning, because Bonum
would keep retrying.

Payment results carry `environment`. With `BONUM_ENV=production`, their text starts with a
production warning.

## Resources and prompts

Resources (Markdown, written for this project; each links to Bonum's official pages):

| URI                          | Contents                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `bonum://guides/integration` | The V2 flow, keeping the key on the server, Apple Pay and Google Pay with `waitForResult`, reconciliation |
| `bonum://guides/webhooks`    | Verification, raw body per framework, two-level idempotency, the retry schedule, local testing            |
| `bonum://reference/api`      | Endpoints, fields, statuses and errors                                                                    |
| `bonum://checklists/go-live` | What to check before taking real payments                                                                 |

In Claude Code, mention one with `@bonum:bonum://guides/webhooks`.

Prompts:

| Prompt                     | Arguments                                                                                    | What it does                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `integrate_bonum`          | `framework` (express, nextjs, hono, fastify, nestjs, other), `wallets` (apple, google, both) | Adds `bonum-psp` to the current project, then validates the webhook with `send_test_webhook`.                        |
| `debug_webhook`            | `symptom`                                                                                    | Walks through raw body, secret and environment, clock skew, proxies and global JSON parsers, using `verify_webhook`. |
| `review_bonum_integration` | —                                                                                            | Audits an existing integration against the go-live rules.                                                            |

In Claude Code, prompts are slash commands: `/mcp__bonum__integrate_bonum nextjs both`.

## Example requests

- _"Check my Bonum connection."_
- _"What's the status of order ORD-1001?"_
- _"Wait for payment 3f0c2c8e-… to finish."_
- _"Test my webhook at http://localhost:3000/webhooks/bonum."_
- _"My webhook says signature mismatch. Here are the raw body and headers I logged: …"_
- _"Create a signed FAILED test webhook for order ORD-7 and give me the curl command."_

## Safety model

- **Read-only towards Bonum.** The payment tools only look payments up. There is no tool that
  submits, refunds or changes anything.
- **Secrets only from the environment.** No tool takes a key or secret as an argument, and none
  repeats one. As a last line of defense, every output passes through a redactor that removes the
  configured key and secret.
- **Test webhooks stay local.** `send_test_webhook` only accepts `http`/`https` URLs without
  credentials, and by default only these hosts: `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`
  and `*.test`. Anything else needs `BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS=true`. It never follows
  redirects, and gives up on each request after 10 seconds, Bonum's own limit.
- **No signing for production.** With `BONUM_ENV=production`, `create_test_webhook` and
  `send_test_webhook` refuse to run. `BONUM_ENV` only picks the API host, though, so the real
  protection is to **never give this server your production webhook secret**: anyone who can talk
  to your agent could forge valid production webhooks with it.
- **Honest hints.** Tools that only read are marked read-only, so clients can run them without
  asking. `send_test_webhook` is not, so clients ask before it sends anything.
- **Quiet on stdout.** The server logs only to stderr; stdout carries the MCP protocol.

## Debugging

- Start with `check_connection`: it shows what the server sees, and every configuration warning.
- The server prints one startup line to stderr, such as
  `0.1.0 serving MCP on stdio; Bonum sandbox (https://testpsp.bonum.mn); merchant key set, webhook secret set.`
  Claude Code shows server errors in `/mcp`. Claude Desktop writes server logs to
  `~/Library/Logs/Claude/` on macOS.
- Explore the server with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

  ```bash
  npx @modelcontextprotocol/inspector -e BONUM_ENV=sandbox npx -y bonum-psp-mcp
  ```

- `npx -y bonum-psp-mcp --help` lists the variables, and `--version` prints the version.

## Use as a library

The package also exports the server factory. You can embed the server, serve it over HTTP, or test
it in-process:

```ts
import { createBonumMcpServer, depsFromEnv } from 'bonum-psp-mcp';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const deps = depsFromEnv(process.env); // never throws; problems become deps.warnings
serveStdio(() => createBonumMcpServer(deps));
```

## License

[MIT](./LICENSE) © 2026 Jack Infinite
