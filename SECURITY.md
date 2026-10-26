# Security policy

**English** | [Монгол](./SECURITY.mn.md)

`bonum-psp` handles payment credentials and verifies payment webhooks, so security reports are very
welcome.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub's
[private vulnerability reporting](https://github.com/Jack-infinite/bonum-psp/security/advisories/new)
(the **Security** tab → **Report a vulnerability**).

Please include:

- the affected package (`bonum-psp` or `bonum-psp-mcp`) and version;
- what an attacker could do, and under which conditions;
- steps to reproduce, ideally a minimal script that uses fake credentials.

This is a volunteer project. I aim to acknowledge reports within 5 working days and to agree on a
fix and a disclosure date with you. Once a fix is released, you will be credited in the advisory
if you wish.

## Never share real credentials

Do not paste merchant keys, webhook signing secrets, webhook payloads with customer data, or logs
that contain them into issues, pull requests, discussions or reports. Use fake values such as
`mk_test_example` and `test_webhook_secret`.

**If a key or secret has leaked**, by any route, ask Bonum to rotate it right away. Deleting a
message or commit does not make it secret again. During webhook secret rotation, `BonumWebhooks`
accepts several secrets (`secret: [newSecret, oldSecret]`), so you can switch without downtime.

## Scope

In scope: the code in this repository. That covers the SDK (for example signature verification,
secret handling, URL construction and the browser guard) and the MCP server (for example secret
redaction, the restrictions on `send_test_webhook` targets, and the production safeguards).

Out of scope: Bonum's own API and services. Report problems with those to BONUM LLC directly. This
project is not affiliated with them.

## Supported versions

Security fixes go into the latest minor release of each package. Please upgrade to it before you
report.
