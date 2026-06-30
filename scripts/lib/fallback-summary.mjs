/** Build a changeset summary without an LLM. */
export function buildFallbackSummary({
  commits,
  changedFiles,
  cleanTitle,
  cleanBody,
  affected,
}) {
  const commitSubjects = commits
    .split("\n")
    .filter(Boolean)
    .filter((s) => !/^chore\(changeset\):/i.test(s))
    .map((s) =>
      s.replace(/^(feat|fix|chore|docs|refactor)(\([^)]+\))?!?:\s*/i, "").trim(),
    )
    .filter(Boolean);

  if (commitSubjects.length > 0) {
    const sentence = commitSubjects.join("; ");
    return sentence.charAt(0).toUpperCase() + sentence.slice(1, 281);
  }

  if (cleanBody) {
    const firstLine = cleanBody.split("\n").find((l) => l.trim());
    if (firstLine) return firstLine.trim().slice(0, 280);
  }

  if (cleanTitle) return cleanTitle;

  const pkgFiles = changedFiles.filter(
    (f) => f.startsWith("packages/") && !f.startsWith(".changeset/"),
  );
  return `Update ${affected.join(", ")} (${pkgFiles.slice(0, 2).join(", ")})`;
}
