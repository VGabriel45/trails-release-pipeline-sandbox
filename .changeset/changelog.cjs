/** Plain changelog lines — no PR links, commits, or author attribution. */

/** @type {import("@changesets/types").ChangelogFunctions} */
module.exports = {
  getReleaseLineAsync: async (changeset) => {
    return `- ${changeset.summary}`;
  },

  getDependencyReleaseLineAsync: async (_changesets, dependenciesUpdated) => {
    if (dependenciesUpdated.length === 0) return false;
    return `- Updated dependencies`;
  },
};
