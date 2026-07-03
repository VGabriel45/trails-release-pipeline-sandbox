# Installing this release pipeline on a new repo

The workflows and scripts are **drop-in** — they read the owner/repo and bot
identity from the GitHub Actions context at runtime, so there are no per-repo
values to edit in code. The only work is external setup (GitHub App, secrets,
branches, npm auth), most of which `scripts/setup-repo.sh` automates.

## What you copy

Copy these into the target repo (paths unchanged):

```
.changeset/config.json
.changeset/changelog.cjs
.github/workflows/ai-changeset.yml
.github/workflows/changeset-check.yml
.github/workflows/release-prepare.yml
.github/workflows/release-publish.yml
.github/workflows/release-canary.yml
.github/workflows/verify-app-token.yml
scripts/ai-changeset.mjs
scripts/changeset-check.mjs
scripts/prepare-release.mjs
scripts/publish-release.mjs
scripts/run-canary.mjs
scripts/filter-changesets.mjs
scripts/lib/*.mjs
scripts/setup-repo.sh
```

Then merge into the target `package.json`:

```jsonc
{
  "scripts": {
    "build": "pnpm -r --if-present run build",
    "prepare-release": "gh workflow run release-prepare.yml --ref master",
    "publish-canary": "gh workflow run release-canary.yml --ref master"
  },
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.105.0",          // omit if using GitHub Models
    "@changesets/changelog-github": "^0.7.0",
    "@changesets/cli": "^2.31.0"
  }
}
```

Run your package manager install to update the lockfile.

Each publishable package should define its own `"build"` script (e.g. `tsdown`,
`tsc`). The root `"build"` script runs `pnpm -r --if-present run build`, so
packages without a build step are skipped. **Publish release** runs `pnpm build`
before npm publish (production and canary jobs).

## Branch convention (the one thing that's a fixed name)

This pipeline assumes two branches:

- **`master`** — integration trunk + version source of truth
- **`production`** — released snapshot; a push here triggers publish

GitHub Actions trigger filters can't read env vars, so these names are fixed in
the workflow `on:`/`ref:` fields. If your repo uses different names (e.g.
`main`), rename them in: `ai-changeset.yml` (`branches:`), `release-prepare.yml`
(`ref:` + the script's branch refs), and `release-publish.yml` (`branches:` +
canary job `ref: master`).

## Monorepo

Works out of the box for any number of packages under `packages/*`. Each
package versions independently; the prepare step caps pre-1.0 bumps per package,
writes per-package changelogs, and lists every changed package in the release PR
title. Configure lockstep/exclusions in `.changeset/config.json` (`linked`,
`fixed`, `ignore`, `updateInternalDependencies`). List npm names in **`ignore`**
to skip AI changesets, version bumps, and publish for packages under `packages/`
(e.g. demos or internal apps). `"private": true` packages are already excluded.

**Selective release:** **Prepare release** and canary publish expose a
**packages** dropdown (default: **All modified packages**). Choosing one package
filters changesets before versioning; unselected changesets are held and restored
on `master` after `changeset version`. Add new npm names to the `packages` choice
list in `release-prepare.yml` and `release-publish.yml` when the monorepo grows.

## One-time per org: the GitHub App

Create a single GitHub App and reuse it across all repos (install per repo).

- **Permissions:** Contents: Read & write, Pull requests: Read & write,
  Metadata: Read-only.
- Generate a **private key** (PEM).
- **Install** the app on each target repo.

The bot's commit identity is derived automatically from the app slug at
runtime — nothing to hardcode.

## Per-repo setup (automated by `scripts/setup-repo.sh`)

```bash
# from the target repo clone, authenticated with gh
APP_ID=123456 \
APP_PRIVATE_KEY_FILE=./app.private-key.pem \
ANTHROPIC_API_KEY=sk-ant-... \
bash scripts/setup-repo.sh
```

The script:

1. Detects the repo via `gh`.
2. Creates the `production` branch from the default branch if missing.
3. Sets the secrets it was given (`TRAILS_SDK_RELEASE_BOT_APP_ID`,
   `TRAILS_SDK_RELEASE_BOT_PRIVATE_KEY`, and optional `ANTHROPIC_API_KEY`).
4. Prints the remaining manual checklist.

## Manual steps the script can't do

- **npm auth** — configure **OIDC trusted publishing** for each published
  package (npm package → Settings → Trusted Publisher → `owner/repo`,
  workflow `release-publish.yml`). This pipeline does not use `NPM_TOKEN`.
- **Admin review gate** — protect `production` with a ruleset: require a pull
  request (no direct pushes), restrict merge to admins, and require an admin
  review (needs a public repo or a paid plan for private repos). The publish
  job fires automatically on a push to `production` and also supports an
  admin-only manual `retry-production` mode for failed runs. Manual canary
  publishes use mode `canary` and never touch `latest`/tags/GitHub Releases.

## Secrets reference

| Secret | Required | Purpose |
| --- | --- | --- |
| `TRAILS_SDK_RELEASE_BOT_APP_ID` | yes | GitHub App ID |
| `TRAILS_SDK_RELEASE_BOT_PRIVATE_KEY` | yes | GitHub App private key (PEM) |
| `ANTHROPIC_API_KEY` | optional | LLM prose for changesets (falls back to commit-based summary) |

## Changeset escape hatches

- **`skip-changeset` label** (or `[skip-changeset]` in the PR title/body) —
  internal-only change: no changeset, no bump, check passes.
- **Manual changeset** — commit a `pnpm changeset`-generated `.changeset/*.md`
  in the PR; the AI generator backs off and the check passes without a bump token.

## Verify

1. Actions → **Verify App Token** → Run workflow (confirms the app token works).
2. Open a PR to `master` with `[patch]` in the title that changes a package.
3. Confirm the **AI Changeset** workflow commits `.changeset/pr-<n>.md` back.
4. Run **Prepare release**, then merge the `master → production` PR to publish.
