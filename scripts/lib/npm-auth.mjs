import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function npmrcPath() {
  return process.env.NPM_CONFIG_USERCONFIG || join(homedir(), ".npmrc");
}

// setup-node writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` and a
// placeholder NODE_AUTH_TOKEN. For OIDC that empty/placeholder token shadows the
// trusted-publisher flow, so we strip the auth line and unset the placeholder.
function clearNpmrcAuth() {
  delete process.env.NODE_AUTH_TOKEN;
  const path = npmrcPath();
  if (!existsSync(path)) return;
  const cleaned = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.includes("_authToken"))
    .join("\n");
  writeFileSync(path, cleaned);
}

/** @param {{ workflows?: string[] }} [options] */
export function ensureNpmAuth(options = {}) {
  const workflows = options.workflows ?? ["release-publish.yml"];
  const workflowList = workflows.map((w) => `       workflow: ${w}`).join("\n");

  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    clearNpmrcAuth();
    console.log("Publishing via npm OIDC trusted publishing.");
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "<owner>/<repo>";
  console.error(`
npm authentication is not configured.

This pipeline is OIDC-only. Configure npm trusted publishing on each package:
  repo:     ${repo}
${workflowList}
(needs "id-token: write" in the workflow)
`);
  process.exit(1);
}
