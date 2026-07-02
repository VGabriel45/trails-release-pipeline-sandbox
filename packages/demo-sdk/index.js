/** Sandbox SDK — used to test the release pipeline. */
export function greet(name = "world", { style = "default" } = {}) {
  const trimmed = String(name ?? "").trim();
  const message = `Hello, ${trimmed === "" ? "world" : trimmed}!`;
  if (style === "upper") return message.toUpperCase();
  if (style === "lower") return message.toLowerCase();
  return message;
}

export function farewell(name = "world") {
  return `Goodbye, ${name}!`;
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
  return names
    .filter((name) => name != null && String(name).trim() !== "")
    .map((name) => greet(name, options))
    .join(separator);
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
