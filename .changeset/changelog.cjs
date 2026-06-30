// Portable changelog generator: wraps @changesets/changelog-github but resolves
// the repo from the GITHUB_REPOSITORY env var (always "owner/repo" in GitHub
// Actions) instead of a hardcoded value, so this file is drop-in for any repo.
//
// Set CHANGESET_SNAPSHOT=1 (canary workflow) to skip changelog output entirely —
// snapshot builds only need a version bump + npm publish under the @canary tag.
const github = require("@changesets/changelog-github").default;

const isSnapshot = process.env.CHANGESET_SNAPSHOT === "1";

function githubOptions() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error(
      'GITHUB_REPOSITORY env var is required for changelog generation (expected "owner/repo").',
    );
  }
  return { repo };
}

function plainReleaseLine(changeset) {
  return `- ${changeset.summary}\n`;
}

module.exports = {
  getReleaseLine: (changeset, type) => {
    if (isSnapshot) return Promise.resolve("");
    return github.getReleaseLine(changeset, type, githubOptions()).catch((err) => {
      console.warn(
        `changelog-github failed (${err.message}) — using plain summary.`,
      );
      return plainReleaseLine(changeset);
    });
  },
  getDependencyReleaseLine: (changesets, dependenciesUpdated) => {
    if (isSnapshot) return Promise.resolve("");
    return github
      .getDependencyReleaseLine(changesets, dependenciesUpdated, githubOptions())
      .catch((err) => {
        console.warn(
          `changelog-github dependency line failed (${err.message}) — skipping.`,
        );
        return "";
      });
  },
};
