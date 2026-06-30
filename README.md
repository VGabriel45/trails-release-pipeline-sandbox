# trails-release-pipeline-sandbox

Personal sandbox for testing the Trails SDK release pipeline before rolling it out to `0xsequence/trails`.

## What's here

- **`trails-sdk-release-bot`** GitHub App (App ID `4181013`) — commits AI changesets and runs prepare-release
- **Changesets** with `@changesets/changelog-github`
- **Workflows:** AI changeset generation, changeset check, prepare, publish, canary
- **`demo-sdk`** — minimal publishable package for end-to-end testing

## Secrets (repo)

| Secret | Purpose |
| --- | --- |
| `TRAILS_SDK_RELEASE_BOT_APP_ID` | GitHub App ID |
| `TRAILS_SDK_RELEASE_BOT_PRIVATE_KEY` | App private key (PEM) |
| `ANTHROPIC_API_KEY` | LLM prose for changesets (optional — falls back to PR title) |
| `NPM_TOKEN` | Optional for sandbox npm publish (OIDC later on real repo) |

## Quick test

1. **Verify app token:** Actions → **Verify App Token** → Run workflow
2. **Open a PR** to `master` with `@patch` in the title, change `packages/demo-sdk/index.js`
3. CI generates `.changeset/pr-<n>.md` and commits it back
4. **Prepare release:** Actions → **Release (prepare)** → opens `master → production` PR
5. Merge to `production` → **Release (publish)** runs

## Branches

- `master` — integration + version source of truth
- `production` — released snapshot; merge triggers publish
