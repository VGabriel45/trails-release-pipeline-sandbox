/** Sandbox SDK — used to test the release pipeline. */
export function greet(name = "world", { style = "default" } = {}) {
  const message = `Hello, ${name}!`;
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
