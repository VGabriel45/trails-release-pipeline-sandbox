#!/usr/bin/env bash
# Bootstrap the release pipeline on the current repo.
#
# Usage (from a clone of the target repo, authenticated with `gh`):
#
#   APP_ID=123456 \
#   APP_PRIVATE_KEY_FILE=./app.private-key.pem \
#   bash scripts/setup-repo.sh
#
# Re-runnable: skips work that is already done.
set -euo pipefail

PROD_BRANCH="${PROD_BRANCH:-production}"

command -v gh >/dev/null || { echo "error: gh CLI is required"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: run 'gh auth login' first"; exit 1; }

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
DEFAULT_BRANCH="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"
echo "Repo:            $REPO"
echo "Default branch:  $DEFAULT_BRANCH"
echo "Release branch:  $PROD_BRANCH"
echo

# 1. Create the production branch from the default branch if missing.
if gh api "repos/$REPO/branches/$PROD_BRANCH" >/dev/null 2>&1; then
  echo "✓ branch '$PROD_BRANCH' already exists"
else
  SHA="$(gh api "repos/$REPO/git/refs/heads/$DEFAULT_BRANCH" -q .object.sha)"
  gh api "repos/$REPO/git/refs" -f "ref=refs/heads/$PROD_BRANCH" -f "sha=$SHA" >/dev/null
  echo "✓ created branch '$PROD_BRANCH' from '$DEFAULT_BRANCH'"
fi

# 2. Set secrets that were provided.
set_secret() {
  local name="$1" value="$2"
  [ -z "$value" ] && return 0
  printf '%s' "$value" | gh secret set "$name" --repo "$REPO" --body -
  echo "✓ set secret $name"
}

if [ -n "${APP_ID:-}" ]; then
  set_secret "TRAILS_SDK_RELEASE_BOT_APP_ID" "$APP_ID"
fi

if [ -n "${APP_PRIVATE_KEY_FILE:-}" ]; then
  [ -f "$APP_PRIVATE_KEY_FILE" ] || { echo "error: APP_PRIVATE_KEY_FILE not found: $APP_PRIVATE_KEY_FILE"; exit 1; }
  gh secret set "TRAILS_SDK_RELEASE_BOT_PRIVATE_KEY" --repo "$REPO" < "$APP_PRIVATE_KEY_FILE"
  echo "✓ set secret TRAILS_SDK_RELEASE_BOT_PRIVATE_KEY"
fi

echo
echo "Remaining manual steps:"
echo "  • Install the GitHub App on $REPO (if not already)."
echo "  • npm auth: configure OIDC trusted publishing for each package"
echo "      (npm package → Settings → Trusted Publisher → repo $REPO,"
echo "       workflow release-publish.yml)."
echo "  • Optional: protect '$PROD_BRANCH' with a required admin review."
echo
echo "Verify: Actions → 'Verify App Token' → Run workflow."
