// A "manual" changeset is any .changeset/*.md file added or modified by the PR
// itself, other than the bot-generated pr-<number>.md. When one exists, the
// author has taken ownership of release notes: the AI generator backs off and
// changeset-check passes without requiring a bump token.
export function manualChangesetFiles(changedFiles, prNumber) {
  const botFile = `.changeset/pr-${prNumber}.md`;
  return changedFiles.filter(
    (f) =>
      f.startsWith(".changeset/") &&
      f.endsWith(".md") &&
      f !== botFile &&
      !f.endsWith("README.md"),
  );
}
