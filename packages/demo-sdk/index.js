/** Sandbox SDK — used to test the release pipeline. */
export function greet(name = "world", { uppercase = false } = {}) {
  const message = `Hello, ${name}!`;
  return uppercase ? message.toUpperCase() : message;
}
