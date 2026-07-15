// A "manual" changeset is any .changeset/*.md file added or modified by the PR
// itself. When one exists, the author has taken ownership of release notes and
// changeset-check passes without requiring a skip marker.
export function manualChangesetFiles(changedFiles) {
  return changedFiles.filter(
    (f) =>
      f.startsWith(".changeset/") &&
      f.endsWith(".md") &&
      !f.endsWith("README.md"),
  )
}
