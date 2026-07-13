/** Sandbox utils — second package used to test monorepo releases. */
export function slugify(text = "") {
  const slug = String(text ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function clamp(value, min, max) {
  if (min > max) [min, max] = [max, min];
  const n = Number(value);
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(n) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return lo;
  }
  return Math.min(Math.max(n, lo), hi);
}

/** Truncate text to a max length, appending an ellipsis when shortened. */
export function truncate(text = "", maxLength = 80) {
  const input = String(text ?? "");
  if (maxLength <= 0) return "";
  if (input.length <= maxLength) return input;
  if (maxLength <= 1) return "…";
  return `${input.slice(0, maxLength - 1)}…`;
}

/** Convert text to snake_case (letters/numbers only). */
export function snakeCase(text = "") {
  const snake = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return snake || "untitled";
}
