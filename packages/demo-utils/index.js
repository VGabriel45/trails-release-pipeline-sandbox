/** Sandbox utils — second package used to test monorepo releases. */
export function slugify(text = "") {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function clamp(value, min, max) {
  if (min > max) [min, max] = [max, min];
  return Math.min(Math.max(value, min), max);
}

/** Truncate text to a max length, appending an ellipsis when shortened. */
export function truncate(text = "", maxLength = 80) {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return "…";
  return `${text.slice(0, maxLength - 1)}…`;
}
