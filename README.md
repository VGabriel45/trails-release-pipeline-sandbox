# trails-release-pipeline-sandbox

Personal sandbox for testing the Trails SDK release pipeline before rolling it out to `0xsequence/trails`.

## What's here

- **`trails-sdk-release-bot`** GitHub App (App ID `4181013`) — commits AI changesets and runs prepare-release
- **Changesets** with a portable `@changesets/changelog-github` wrapper (`.changeset/changelog.cjs`)
- **Workflows:** AI changeset generation, changeset check, prepare, publish, canary (dedicated + safety-net)
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

Ignored packages are excluded from AI changeset generation, `changeset-check`,
prepare, and publish. PRs that only touch ignored packages need no bump token
and get no changeset. Use this for demos, examples, or internal tooling that
lives under `packages/` but should not ship to npm.

Packages with `"private": true` in `package.json` are excluded automatically —
`ignore` is for folders that are public on disk but outside the release pipeline.

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

When several packages have pending changesets, **Prepare release** and canary
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

## Release authorization

**Only admins can release.** Real releases still require `master → production`
approval, with one controlled manual retry path:

- **Publish** runs on a push to `production` — i.e. an admin approving and
  merging the `master → production` release PR.
- **Manual dispatch (mode=`retry-production`)** is an admin-only retry path for
  failed production publishes. It always checks out `production` and cannot
  target `master` or a feature branch.
- **Manual dispatch (mode=`canary`)** runs the **Publish canary** job: an
  ephemeral snapshot under the `@canary` dist-tag that never moves `latest`,
  never creates tags or GitHub Releases, and never consumes changesets.
- `production` must only advance from `master` (the release PR). Enforce with a
  ruleset: require a PR, restrict who can push, and require admin review
  (public repo or paid plan for private repos).
- Admins who are npm package owners can still `npm publish` from their machine
  if ever needed; nobody else has a publish path.
