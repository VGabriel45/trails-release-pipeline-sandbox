# Release Pipeline

This repository provides a Changesets-based release pipeline for a pnpm
monorepo. Developers record release intent in their PRs; administrators
control versioning and production publishing.

## Release flow

1. A developer opens a PR to `master`.
2. If it changes a publishable package, the PR includes a manual changeset.
3. After the PR merges to `master`, an admin runs **Prepare release**.
4. The workflow creates or updates a `master → production` release PR with
   version and changelog updates.
5. An admin reviews and merges that release PR. The push to `production`
   triggers npm publishing.

`master` is the integration branch and version source of truth. `production`
contains the published release state and should advance only through release
PRs.

## Administrator setup

For full installation instructions when copying this pipeline to another
repository, see [SETUP.md](./SETUP.md).

Before using the pipeline, an administrator must complete the following.

### 1. Install the GitHub App

Install the shared release GitHub App on the repository and grant it:

- **Contents:** read and write
- **Pull requests:** read and write
- **Metadata:** read-only

Create a private key for the app, then add these repository secrets:

| Secret | Purpose |
| --- | --- |
| `TRAILS_SDK_RELEASE_BOT_APP_ID` | GitHub App ID |
| `TRAILS_SDK_RELEASE_BOT_PRIVATE_KEY` | GitHub App private key in PEM format |

The workflows use this app to create release commits and release PRs. Its bot
identity is derived from the app slug; no bot username is hardcoded.

Verify the configuration from **Actions → Verify App Token → Run workflow**.

### 2. Configure npm trusted publishing

This pipeline publishes with npm OIDC, not an `NPM_TOKEN`. For every public
package, configure npm **Trusted Publisher** with:

- the GitHub owner and repository
- workflow file: `release-publish.yml`

The workflow requires `id-token: write`; do not replace this with a long-lived
npm token.

### 3. Protect release branches

Configure branch rules so:

- `production` accepts changes only through pull requests.
- Only release administrators can merge to `production`.
- A release PR requires administrator approval.
- Direct pushes to `production` are blocked.

Keep merge commits enabled for `master → production` release PRs, and do not
enable a rule that requires linear history on `production`. Release PRs must be
merged with **Create a merge commit**, not squash or rebase. This preserves the
shared branch history needed to avoid recurring conflicts in package manifests
and changelogs.

Feature PRs into `master` may still use your normal merge strategy, including
squash merges.

### 4. Confirm repository conventions

The supplied workflows assume:

- `master` is the integration branch.
- `production` is the release branch.
- publishable packages live under `packages/*`.
- the root build command is `pnpm build`.

See [SETUP.md](./SETUP.md) for changing branch names, adding package choices to
release workflow inputs, and copying the required files into another repository.

## Developer requirements

PRs that change a publishable package must include a manually authored
changeset. From the repository root:

```bash
pnpm changeset
```

Select the affected package and choose the appropriate semantic-version bump.
Commit the generated `.changeset/*.md` file with the package change.

For an internal-only change that should not publish, add the `skip-changeset`
label to the PR or include `[skip-changeset]` in its title or description.

The pipeline does not auto-generate PR changesets. If neither a manual
changeset nor a skip marker is present, **Changeset Check** fails.

## Run a production release

1. Confirm the intended feature and fix PRs, including their changesets, have
   merged into `master`.
2. Open **Actions → Prepare release → Run workflow**.
3. Choose **All modified packages**, or select a specific package when you
   intentionally want a partial release.
4. Review the resulting `master → production` release PR. It contains the
   package version updates, changelog entries, and consumed changesets.
5. Merge it using **Create a merge commit**.
6. Confirm **Publish release** completes. It publishes to npm, creates package
   tags, and creates GitHub releases.

The manual **Publish release** workflow is not a shortcut for an ordinary
release. Its `retry-production` mode is an admin-only recovery path for a
failed production publish and always runs against the current `production`
tip.

## Canary releases

To publish a test snapshot without moving the npm `latest` tag:

1. Open **Actions → Publish release → Run workflow**.
2. Choose `canary` mode and select the package scope.
3. Confirm the **Publish canary** job succeeds.

Canary releases use the `canary` dist-tag, do not create production tags or
GitHub releases, and do not consume the changesets intended for the next normal
release.

## Versioning notes

Changesets uses standard semantic-version bumps for packages at `1.0.0` and
above. For packages at `0.x`, this pipeline intentionally treats a `major`
changeset as the next minor version rather than promoting directly to `1.0.0`.

| Changeset type | Example from `0.2.0` |
| --- | --- |
| `patch` | `0.2.1` |
| `minor` | `0.3.0` |
| `major` | `0.3.0` |

To intentionally release `1.0.0`, set that version in the package manifest on
`master` before running **Prepare release**.

## Troubleshooting

- **Changeset Check fails:** add a manual `.changeset/*.md` file or use the
  `skip-changeset` label for an internal-only PR.
- **npm publish fails:** verify the package's npm Trusted Publisher matches this
  repository and `release-publish.yml`, then use the admin-only
  `retry-production` mode after correcting the configuration.
- **The release PR conflicts:** confirm previous `master → production` release
  PRs were merged with a merge commit. Squash or rebase merges rewrite the
  shared history and cause repeated conflicts in `package.json` and
  `CHANGELOG.md`.
