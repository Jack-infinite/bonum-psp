# bonum-psp

**English** | [Монгол](./README.mn.md)

[![CI](https://github.com/Jack-infinite/bonum-psp/actions/workflows/ci.yml/badge.svg)](https://github.com/Jack-infinite/bonum-psp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

A TypeScript toolkit for **Bonum PSP V2**, which processes Apple Pay and Google Pay payments
asynchronously: you submit a wallet token, and the bank's answer arrives later by webhook or by
lookup. Getting that flow right takes more than an HTTP call: raw-body signature checks,
idempotent fulfilment, a wallet sheet that closes after 30 seconds, and payments that stay
`PENDING`. This repository packages those details, so each integration does not have to
rediscover them.

| Package                                                   | What it is                                                                                                                                                                                            |                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`bonum-psp`](./packages/sdk)                             | Server-side SDK: typed client for the five V2 endpoints, Bonum Gateway invoices (QPay, cards and more), webhook verification, Fetch and Express handlers, testing helpers. Zero runtime dependencies. | [README](./packages/sdk/README.md) · [npm](https://www.npmjs.com/package/bonum-psp)     |
| [`bonum-psp-mcp`](./packages/mcp)                         | MCP server for AI coding agents (Claude Code, Codex, Cursor, Claude Desktop, VS Code): check payments, create invoices, debug webhooks, test your webhook endpoint.                                   | [README](./packages/mcp/README.md) · [npm](https://www.npmjs.com/package/bonum-psp-mcp) |
| [`bonum-psp-integration`](./skills/bonum-psp-integration) | Agent Skill that teaches Claude Code and Codex to integrate Bonum V2 correctly with the SDK.                                                                                                          | [SKILL.md](./skills/bonum-psp-integration/SKILL.md)                                     |

## In 30 seconds

```bash
npm install bonum-psp
```

```ts
import { BonumClient } from 'bonum-psp';

const bonum = new BonumClient(); // BONUM_MERCHANT_KEY, BONUM_ENV, BONUM_WEBHOOK_SECRET

const submission = await bonum.payments.submitApplePay({
  orderId: 'ORD-1001',
  token,
  amount: 150.5,
});
const result = await bonum.payments.waitForResult(submission); // AUTHORIZED | FAILED | PENDING

const event = await bonum.webhooks.verify(rawBody, req.headers); // in your webhook route
```

Let your coding agent test your webhook endpoint:

```bash
claude mcp add --env BONUM_WEBHOOK_SECRET=... --env BONUM_ENV=sandbox \
  --transport stdio bonum -- npx -y bonum-psp-mcp
# then: "Test my webhook at http://localhost:3000/webhooks/bonum"
```

## Install the Agent Skill

The skill follows the open [Agent Skills](https://agentskills.io) format, so the same folder works
in Claude Code and Codex. Copy `skills/bonum-psp-integration` into the skills folder of your project
or of your user account:

| Agent       | Project                                 | All your projects                         |
| ----------- | --------------------------------------- | ----------------------------------------- |
| Claude Code | `.claude/skills/bonum-psp-integration/` | `~/.claude/skills/bonum-psp-integration/` |
| Codex       | `.agents/skills/bonum-psp-integration/` | `~/.agents/skills/bonum-psp-integration/` |

For example, from the root of your project:

```bash
git clone --depth 1 https://github.com/Jack-infinite/bonum-psp.git /tmp/bonum-psp
mkdir -p .claude/skills && cp -R /tmp/bonum-psp/skills/bonum-psp-integration .claude/skills/
```

The agent then uses the skill whenever you work on a Bonum integration. In Claude Code you can also
invoke it directly with `/bonum-psp-integration`.

## Examples

- [`examples/express`](./examples/express): Express 5 with an Apple Pay endpoint and the webhook
  route.
- [`examples/nextjs-app-router`](./examples/nextjs-app-router): a Next.js route handler for
  webhooks.

[`docs/environments.md`](./docs/environments.md) explains how to set up sandbox, production and
tests.

## Official Bonum documentation

- [Integration guide](https://psp.bonum.mn/v2/integration-guide.html)
- [API reference](https://psp.bonum.mn/v2/api-reference.html)
- [Webhook guide](https://psp.bonum.mn/v2/webhook-guide.html)
- [Migration guide](https://psp.bonum.mn/v2/migration-guide.html)

Choices this project made where Bonum's documentation is ambiguous are recorded in
[`docs/decisions.md`](./docs/decisions.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md); development needs Node.js 26
and pnpm 12. Please report security issues privately, as described in [SECURITY.md](./SECURITY.md),
and never paste merchant keys or webhook secrets into issues.

## License

[MIT](./LICENSE) © 2026 Jack Infinite. The Bonum name belongs to BONUM LLC and is used here only to
describe what this software works with.
