# Release Pipeline Overview

This pipeline automates versioning and publishing for a multi-package app, with admin-controlled production releases and optional canary snapshots.

## How it works

1. A developer opens a PR targeting `master`.
2. CI checks release intent: PRs that touch publishable packages must include a manual `.changeset/*.md`, unless explicitly marked `[skip-changeset]`/`skip-changeset`.
3. The PR is reviewed and merged into `master`.
4. **Prepare release** computes version bumps and opens/updates `master -> production`.
5. Admin merges `master -> production`, and that push triggers **Publish release**.

> **Reusing this on another repo?** The workflows/scripts are drop-in (no
> hardcoded owner/repo/bot values). See [`SETUP.md`](./SETUP.md) and
> `scripts/setup-repo.sh`.

## Secrets (repo)

| Secret | Purpose |.
| --- | --- |
| `TRAILS_SDK_RELEASE_BOT_APP_ID` | GitHub App ID |
| `TRAILS_SDK_RELEASE_BOT_PRIVATE_KEY` | App private key (PEM) |
| `ANTHROPIC_API_KEY` | LLM prose for changesets (optional — falls back to PR title) |
| _No npm token secret_ | Publishing is OIDC-only via npm trusted publishing |

### npm publish auth (sandbox)

This pipeline is OIDC-only: configure npm **Trusted Publisher** for each
package (npm → package → Settings → Trusted Publisher) to:

- repo: `VGabriel45/trails-release-pipeline-sandbox`
- workflow: `release-publish.yml`

Then pushing/merging to `production` triggers **Publish release**.

## Quick test

1. **Verify app token:** Actions → **Verify App Token** → Run workflow
2. **Open a PR** to `master` with `[patch]` in the title, change `packages/demo-sdk/index.js`
3. CI generates `.changeset/pr-<n>.md` and commits it back
4. **Prepare release:** Actions → **Prepare release** → pick package (default: **All modified packages**) → opens `master → production` PR
5. Merge to `production` → **Publish release** runs

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
running **Prepare release**.

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

### Ignoring packages (no auto changeset, no release)

Add npm package names to the **`ignore`** array in `.changeset/config.json`:

```json
{
  "ignore": ["@0xtrails/demo", "internal-playground"]
}
```

## CI/CD pieces

- **GitHub App**: acts as release bot for workflow commits/automation.
- **changeset-check**: validates release intent per PR.
- **release-prepare**: bumps versions, updates changelogs, opens release PR.
- **release-publish**: publishes to npm on `production` push; supports admin retry mode.
- **release-canary**: manual canary snapshots (`@canary`) without affecting `latest`.

## How to use

- **Normal release**
  - Merge feature/fix PRs into `master`.
  - Run **Prepare release**.
  - Review and merge `master -> production`.
  - Publish runs automatically on `production`.

- **Canary release**
  - Run **Publish canary release**.
  - Select package scope (`All modified packages` or a specific package).
  - Publishes snapshot versions under `@canary`.

- **Retry failed production publish**
  - Run **Publish release** with `mode=retry-production` (admin-only).

## Changeset behavior

- **Required gate for publishable changes**: if a PR changes publishable packages, you must provide one of:
  - a manual `.changeset/*.md` file committed in the PR
  - `skip-changeset` label or `[skip-changeset]` for internal-only changes
- **Failure mode**: if none of the above is present, `changeset-check` fails.
- **Skip mode**: use `skip-changeset` label or `[skip-changeset]` for internal-only PRs.
- **Selective release**: workflows support package filtering via `packages` input.

### Pre-1.0 versioning rule (`0.x`)

For packages still on `0.x`, this pipeline does not fully apply strict semver majors when versioning from changesets:

- `patch` -> patch bump (`0.2.0` -> `0.2.1`)
- `minor` -> minor bump (`0.2.0` -> `0.3.0`)
- `major` -> treated like minor (`0.2.0` -> `0.3.0`, not `1.0.0`)

## Security model

- **OIDC-only npm publish**: no long-lived npm token required.
- **Admin-gated production**: production release path is controlled by branch protections and admin review.
- **Canary isolation**: canary publishes do not move `latest` and do not create production tags/releases.
