/** Sandbox utils — second package used to test monorepo releases. */
export function slugify(text = "") {
  const slug = String(text ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function clamp(value, min, max) {
  if (min > max) [min, max] = [max, min];
  return Math.min(Math.max(value, min), max);
}

/** Truncate text to a max length, appending an ellipsis when shortened. */
export function truncate(text = "", maxLength = 80) {
  const input = String(text ?? "");
  if (maxLength <= 0) return "";
  if (input.length <= maxLength) return input;
  if (maxLength <= 1) return "…";
  return `${input.slice(0, maxLength - 1)}…`;
}
