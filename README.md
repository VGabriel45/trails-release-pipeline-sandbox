# trails-release-pipeline-sandbox

Personal sandbox for testing the Trails SDK release pipeline before rolling it out to `0xsequence/trails`.

## What's here

- **`trails-sdk-release-bot`** GitHub App (App ID `4181013`) — commits AI changesets and runs prepare-release
- **Changesets** with a portable `@changesets/changelog-github` wrapper (`.changeset/changelog.cjs`)
- **Workflows:** AI changeset generation, changeset check, prepare, publish, canary
- **`@vgabriel45/demo-sdk`** and **`@vgabriel45/demo-utils`** — two publishable
  packages so monorepo behavior (independent versions) is exercised end-to-end

> **Reusing this on another repo?** The workflows/scripts are drop-in (no
> hardcoded owner/repo/bot values). See [`SETUP.md`](./SETUP.md) and
> `scripts/setup-repo.sh`.

## Secrets (repo)

| Secret | Purpose |
| --- | --- |
| `TRAILS_SDK_RELEASE_BOT_APP_ID` | GitHub App ID |
| `TRAILS_SDK_RELEASE_BOT_PRIVATE_KEY` | App private key (PEM) |
| `ANTHROPIC_API_KEY` | LLM prose for changesets (optional — falls back to PR title) |
| `NPM_TOKEN` | npm publish — **required for sandbox** unless OIDC trusted publishing is configured (see below) |

### npm publish auth (sandbox)

`@vgabriel45/demo-sdk` does not exist on npm yet — the **first publish creates it**. Use an automation token for that:

1. [npmjs.com](https://www.npmjs.com) → Access Tokens → **Automation** token (publish scope for your account)
2. Repo → Settings → Secrets → Actions → add **`NPM_TOKEN`**
3. Push these changes to `production`, then run **Release (publish)** (or re-run the workflow)

After the package exists, you can optionally switch to **OIDC trusted publishing** (npm → package → Trusted Publisher → `VGabriel45/trails-release-pipeline-sandbox` / `release-publish.yml`) and remove `NPM_TOKEN`.

## Quick test

1. **Verify app token:** Actions → **Verify App Token** → Run workflow
2. **Open a PR** to `master` with `[patch]` in the title, change `packages/demo-sdk/index.js`
3. CI generates `.changeset/pr-<n>.md` and commits it back
4. **Prepare release:** Actions → **Release (prepare)** → pick package (default: **All modified packages**) → opens `master → production` PR
5. Merge to `production` → **Release (publish)** runs

## Versioning (pre-1.0)

Packages still at `0.x` are treated as early-development and do **not** follow
strict semver yet — we don't want a breaking change to auto-promote to `1.0.0`.
While a package's version is `0.x`, prepare-release caps bumps:

| PR token | Effect while `0.x` | Example |
| --- | --- | --- |
| `[patch]` | 3rd digit | `0.2.0 → 0.2.1` |
| `[minor]` | 2nd digit | `0.2.0 → 0.3.0` |
| `[major]` | 2nd digit (**capped**, no `1.0.0`) | `0.2.0 → 0.3.0` |

The cap lifts automatically once a package reaches `1.x`. To force a specific
version (e.g. cutting `1.0.0`), set it in `package.json` on `master` before
running **Release (prepare)**.

## Changesets: skipping the AI or writing your own

The AI changeset is the default, not the only path:

- **Skip entirely (internal-only changes):** add the **`skip-changeset` label**
  to the PR, or put `[skip-changeset]` in the title/description. The AI removes
  any changeset it already generated and `changeset-check` passes — the PR ships
  with no CHANGELOG entry and no version bump.
- **Write it by hand:** run `pnpm changeset` locally and commit the generated
  `.changeset/*.md` file with your PR. When a PR adds its own changeset, the AI
  backs off (it won't generate or overwrite anything) and `changeset-check`
  passes without needing a bump token in the title.

Don't hand-edit the bot's `.changeset/pr-<n>.md` — it is regenerated on every
push. Use `pnpm changeset` (any other filename) to take ownership.

## Monorepo

Each package versions **independently** — a release can bump `demo-sdk` to
`1.1.0` and `demo-utils` to `0.2.0` at the same time. The prepare step:

- bumps each package per its own changesets and writes each package's own
  `CHANGELOG.md`;
- applies the pre-1.0 cap **per package** (only `0.x` packages are capped);
- titles the release PR with every changed package, e.g.
  `Release: demo-sdk@1.1.0, demo-utils@0.2.0`.

Publish then creates one git tag + one GitHub Release **per package**.

### Selective release (`packages`)

When several packages have pending changesets, **Release (prepare)** and canary
publish expose a **packages** dropdown (default: **All modified packages**).
Choosing a single package filters changesets before `changeset version`; held
changesets for other packages are restored on `master` so they can ship in a
later release.

```
gh workflow run release-prepare.yml --ref master \
  -f packages="@vgabriel45/demo-sdk"
```

GitHub Actions `choice` options are static — add new packages to
`release-prepare.yml` and `release-publish.yml` when the monorepo grows.

Tune lockstep/independence and exclusions in `.changeset/config.json`
(`linked`, `fixed`, `ignore`, `updateInternalDependencies`).

## Branches

- `master` — integration + version source of truth
- `production` — released snapshot; merge triggers publish
