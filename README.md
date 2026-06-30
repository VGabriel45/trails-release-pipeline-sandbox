# trails-release-pipeline-sandbox

Personal sandbox for testing the Trails SDK release pipeline before rolling it out to `0xsequence/trails`.

## What's here

- **`trails-sdk-release-bot`** GitHub App (App ID `4181013`) — commits AI changesets and runs prepare-release
- **Changesets** with `@changesets/changelog-github`
- **Workflows:** AI changeset generation, changeset check, prepare, publish, canary
- **`@vgabriel45/demo-sdk`** — minimal publishable package for end-to-end testing

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
4. **Prepare release:** Actions → **Release (prepare)** → opens `master → production` PR
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

The cap lifts automatically once a package reaches `1.x`.

### Maintainer override (`release_as`)

To force an explicit version (e.g. to finally cut `1.0.0`), run **Release
(prepare)** with the `release_as` input:

```
gh workflow run release-prepare.yml --ref master -f release_as=1.0.0
```

`release_as` skips the pre-1.0 cap and sets every publishable package to that
exact version (changelog entry included).

## Branches

- `master` — integration + version source of truth
- `production` — released snapshot; merge triggers publish
