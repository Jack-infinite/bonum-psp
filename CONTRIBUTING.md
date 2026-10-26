# Contributing

**English** | [Монгол](./CONTRIBUTING.mn.md)

Thanks for helping! This is an unofficial, community-maintained project for Bonum PSP V2. Bug
reports, fixes, docs improvements and framework recipes are all welcome.

By taking part, you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). Report security issues
privately, as described in [SECURITY.md](./SECURITY.md), not in public issues.

## Setup

You need **Node.js 26** for development (see `.nvmrc`; the packages themselves support Node
22.12+) and **pnpm 12**:

```bash
npm install --global pnpm@12   # the exact version is pinned in package.json ("packageManager")
git clone https://github.com/Jack-infinite/bonum-psp.git
cd bonum-psp
pnpm install
pnpm check                     # everything CI runs; must be green before you open a PR
```

No Bonum credentials are needed: every test runs against fakes. The only exception is
`packages/sdk/test/sandbox.test.ts`, which runs only when you set `BONUM_SANDBOX_MERCHANT_KEY`. It
makes one harmless lookup of a random payment id.

## Scripts

| Script                          | What it does                                                     |
| ------------------------------- | ---------------------------------------------------------------- |
| `pnpm check`                    | lint + build + typecheck + test + package checks (publint, attw) |
| `pnpm build`                    | Build both packages (also regenerates `src/version.ts`)          |
| `pnpm test` / `pnpm test:watch` | Vitest with coverage / watch mode                                |
| `pnpm typecheck`                | TypeScript, per package                                          |
| `pnpm lint` / `pnpm format`     | Biome and knip / apply Biome fixes and formatting                |
| `pnpm changeset`                | Record a change for the changelog and the next release           |

[AGENTS.md](./AGENTS.md) describes the architecture and the coding rules: strict TypeScript, no
`any`, TSDoc with an example on every public export, no secrets in output, and more. Please read
it before larger changes. [`docs/decisions.md`](./docs/decisions.md) explains choices that may look
surprising.

## Changes to the packages

- **Tests:** add or update tests with every behavior change. Coverage thresholds are enforced
  (SDK ≥ 95 % lines and ≥ 90 % branches, MCP ≥ 85 % lines).
- **Changesets:** user-facing changes to `bonum-psp` or `bonum-psp-mcp`, dependency updates of
  the MCP server included, need a changeset. Run `pnpm changeset`, pick the packages and the bump,
  and write one or two sentences for the changelog. While the packages are at 0.x, use `minor` for
  breaking changes and `patch` for everything else. Docs-only and test-only changes need no
  changeset.
- **Docs:** update the package README when you change behavior or the public API. Documents with
  a Mongolian copy (`.mn.md`: the READMEs, CONTRIBUTING, SECURITY, RELEASING, `docs/decisions`)
  need the same change in that copy.
- **Bonum's documentation:** never copy its text into this repository; their pages carry a
  confidentiality notice. Describe things in your own words and link to
  <https://psp.bonum.mn/v2/>. Field names, endpoint paths and the signing algorithm are facts and
  fine to use.
- **Secrets:** never commit or paste a real merchant key or webhook secret, not even an expired
  one. Use obviously fake values such as `mk_test_example` and `test_webhook_secret`.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), with a scope
where it helps:

```
feat(sdk): accept ArrayBuffer bodies in verify()
fix(mcp): explain ECONNRESET in send_test_webhook
docs(skill): add a Fastify snippet
chore(deps): bump zod to 4.7.0
```

Common scopes are `sdk`, `mcp`, `skill`, `docs`, `examples`, `ci` and `deps`. Keep pull requests
focused: one topic per PR, with a short description of the why. CI runs `pnpm check` on Node 22, 24
and 26.

## Releases

The maintainer releases with Changesets; see [RELEASING.md](./RELEASING.md). Contributors only add
changesets.
