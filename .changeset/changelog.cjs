// Portable changelog generator: wraps @changesets/changelog-github but resolves
// the repo from the GITHUB_REPOSITORY env var (always "owner/repo" in GitHub
// Actions) instead of a hardcoded value, so this file is drop-in for any repo.
const github = require("@changesets/changelog-github").default;

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) {
  throw new Error(
    "GITHUB_REPOSITORY env var is required for changelog generation (expected \"owner/repo\").",
  );
}

const options = { repo };

module.exports = {
  getReleaseLine: (changeset, type) =>
    github.getReleaseLine(changeset, type, options),
  getDependencyReleaseLine: (changesets, dependenciesUpdated) =>
    github.getDependencyReleaseLine(changesets, dependenciesUpdated, options),
};
