/** Sandbox SDK — used to test the release pipeline. */
export function greet(name = "world", { uppercase = false } = {}) {
  const message = `Hello, ${name}!`;
  return uppercase ? message.toUpperCase() : message;
}

export function farewell(name = "world") {
  return `Goodbye, ${name}!`;
}

/** Returns a short celebration string for release testing. */
export function celebrate(event = "release") {
  return `🎉 ${event} shipped!`;
}
