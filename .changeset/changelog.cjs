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

function plainReleaseLine(changeset) {
  return `- ${changeset.summary}\n`;
}

module.exports = {
  getReleaseLine: (changeset, type) => {
    if (process.env.CHANGESET_PLAIN_CHANGELOG === "1") {
      return Promise.resolve(plainReleaseLine(changeset));
    }
    return github.getReleaseLine(changeset, type, options).catch((err) => {
      console.warn(
        `changelog-github failed (${err.message}) — using plain summary.`,
      );
      return plainReleaseLine(changeset);
    });
  },
  getDependencyReleaseLine: (changesets, dependenciesUpdated) => {
    if (process.env.CHANGESET_PLAIN_CHANGELOG === "1") {
      return Promise.resolve("");
    }
    return github
      .getDependencyReleaseLine(changesets, dependenciesUpdated, options)
      .catch((err) => {
        console.warn(
          `changelog-github dependency line failed (${err.message}) — skipping.`,
        );
        return "";
      });
  },
};
