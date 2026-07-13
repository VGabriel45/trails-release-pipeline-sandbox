/** Sandbox SDK — used to test the release pipeline. */
export function greet(name = "world", { style = "default" } = {}) {
  const trimmed = String(name ?? "").trim();
  const message = `Hello, ${trimmed === "" ? "world" : trimmed}!`;
  if (style === "upper") return message.toUpperCase();
  if (style === "lower") return message.toLowerCase();
  return message;
}

export function farewell(name = "world") {
  const trimmed = String(name ?? "").trim();
  return `Goodbye, ${trimmed === "" ? "world" : trimmed}!`;
}

/** Returns a short celebration string for release testing. */
export function celebrate(event = "release") {
  return `🎉 ${event} shipped!`;
}

/** Greet with a leading emoji (defaults to wave). */
export function greetEmoji(name = "world", emoji = "👋", options = {}) {
  return `${emoji} ${greet(name, options)}`;
}

/** Greet several people at once, joined with a separator. */
export function greetMany(names = [], { separator = " ", ...options } = {}) {
  const list = Array.isArray(names) ? names : [names];
  return list
    .filter((name) => name != null && String(name).trim() !== "")
    .map((name) => greet(name, options))
    .join(separator);
}

/** Greet two people with an "and" joiner. */
export function greetPair(first = "world", second = "world", options = {}) {
  return `${greet(first, options)} and ${greet(second, options)}`;
}

/** Title-case a display name for UI labels. */
export function formatName(name = "") {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Initials from a display name, e.g. "jane doe" -> "JD". */
export function formatInitials(name = "") {
  return formatName(name)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0))
    .join("");
}

/** Format display text into a URL-friendly slug. */
export function formatSlug(text = "") {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Return a stable marker used for release-flow demos. */
export function getDemoSdkMarker() {
  return "demo-sdk-change";
}
