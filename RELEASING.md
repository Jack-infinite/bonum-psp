# Releasing

**English** | [Монгол](./RELEASING.mn.md)

Both packages are versioned independently with [Changesets](https://changesets.dev) and published
from GitHub Actions with npm **trusted publishing** (OIDC). The repository holds no npm token, and
every release gets a provenance attestation.

Trusted publishing can only be set up for packages that already exist on npm. So the very first
release (`0.1.0` of both packages) is published by hand, once.

## One-time setup

### 1. Publish 0.1.0 by hand

Use an npm account with two-factor authentication turned on.

```bash
npm login
pnpm install
pnpm check                 # everything green, including the tarball checks

cd packages/sdk
pnpm publish --access public
cd ../mcp
pnpm publish --access public   # pnpm turns `workspace:^` into ^0.1.0 in the published package.json
```

Publish the SDK first: the MCP server depends on it. Use `pnpm publish`, not `npm publish`. Only
pnpm rewrites the `workspace:^` range. Check the result with `npm view bonum-psp-mcp dependencies`.
If pnpm refuses because `main` has no upstream branch yet, add `--no-git-checks`, but only on a
clean working tree that you have just checked.

Do this **before** the first push to `main` on GitHub. Otherwise the release workflow tries to
publish `0.1.0` itself and fails, because no trusted publisher exists yet. That failure is
harmless; the run after the setup below will be green.

### 2. Trust the release workflow

This needs npm CLI 11.15 or later (`npm --version`) and two-factor authentication:

```bash
npm trust github bonum-psp --file release.yml --repo Jack-infinite/bonum-psp --allow-publish
npm trust github bonum-psp-mcp --file release.yml --repo Jack-infinite/bonum-psp --allow-publish
```

Optionally, afterwards, turn on **Require two-factor authentication and disallow tokens** in each
package's npm settings. Trusted publishing keeps working.

### 3. GitHub settings

- The repository must be **public**: npm only adds provenance for public repositories.
- **Settings → Actions → General:** allow GitHub Actions to create and approve pull requests. The
  version job opens the "Version Packages" pull request.
- **Settings → Rules:** protect `main` (pull requests and the CI checks required).
- **Settings → Security:** turn on private vulnerability reporting (see `SECURITY.md`) and
  Dependabot alerts.

## Every release after that

1. In each pull request that changes a package for users, run `pnpm changeset`, pick the packages
   and the bump type, and commit the generated file in `.changeset/`.
2. When such a pull request is merged, the release workflow opens or updates a pull request named
   **"chore: version packages"**. It bumps versions, writes the `CHANGELOG.md` files and updates
   `src/version.ts`.
3. GitHub does not run other workflows on pull requests opened with the built-in token. To get
   CI checks on that pull request, close and reopen it.
4. Merge it. The workflow then runs `pnpm check`, packs each package with `pnpm pack` and
   publishes with `pnpm publish` through OIDC. It also pushes git tags such as `bonum-psp@0.2.0`
   and creates GitHub releases.

How the workflow is built (`.github/workflows/release.yml`):

| Job           | Runs when                   | Permissions                               |
| ------------- | --------------------------- | ----------------------------------------- |
| `select-mode` | every push to `main`        | `contents: read`                          |
| `version`     | there are changesets        | `contents: write`, `pull-requests: write` |
| `pack`        | versions are not on npm yet | `contents: read`                          |
| `publish`     | after `pack`                | `contents: write`, `id-token: write`      |

Only the `publish` job can get an OIDC token, and it runs nothing but the publish step on tarballs
that were built and checked in `pack`. Release jobs use no dependency cache, and install with
`--ignore-scripts`.

## If something goes wrong

- **`publish` fails with 404 or 403:** the trusted publisher does not match. Check the package
  name, the repository (`Jack-infinite/bonum-psp`) and the workflow file name (`release.yml`)
  under each package's **Settings → Trusted publishing** on npmjs.com.
- **A version was published, but tagging failed:** re-run the failed job. Changesets skips versions
  that already exist on npm.
- **Never unpublish** a version that people may have installed. Publish a fixed patch release
  instead, and deprecate the broken one with `npm deprecate bonum-psp@<version> "<reason>"`.
