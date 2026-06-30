/** Build a changeset summary without an LLM. */
export function buildFallbackSummary({
  commitSubjects,
  changedFiles,
  cleanTitle,
  cleanBody,
  affected,
}) {
  const subjects = commitSubjects.filter(Boolean);

  if (subjects.length > 0) {
    const sentence = subjects.join("; ");
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

/** Strip conventional-commit prefix from a subject line. */
export function stripConventionalPrefix(subject) {
  return subject
    .replace(/^(feat|fix|chore|docs|refactor)(\([^)]+\))?!?:\s*/i, "")
    .trim();
}

