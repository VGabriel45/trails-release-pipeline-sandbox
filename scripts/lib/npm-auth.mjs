import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function execOut(cmd, env = process.env) {
  return execSync(cmd, {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

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

  const token = process.env.NPM_TOKEN;

  if (token) {
    process.env.NODE_AUTH_TOKEN = token;
    try {
      const whoami = execOut("npm whoami --registry=https://registry.npmjs.org");
      console.log(`npm authenticated via token as: ${whoami}`);
    } catch {
      console.error("npm whoami failed — NPM_TOKEN is present but not valid.");
      process.exit(1);
    }
    return;
  }

  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    clearNpmrcAuth();
    console.log("No NPM_TOKEN — publishing via npm OIDC trusted publishing.");
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "<owner>/<repo>";
  console.error(`
npm authentication is not configured.

Set ONE of:
  1. NPM_TOKEN repo secret — npm token with WRITE access to the package scope
     (Automation token recommended).
  2. npm OIDC trusted publishing — on each package's npm Settings → Trusted Publisher:
       repo:     ${repo}
${workflowList}
     (needs "id-token: write" in the workflow and no NPM_TOKEN set)
`);
  process.exit(1);
}
