/** Sandbox utils — second package used to test monorepo releases. */
export function slugify(text = "") {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
