import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

function execOut(cmd, env = process.env) {
  return execSync(cmd, { encoding: "utf8", env: { ...process.env, ...env } }).trim();
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

function ensureNpmAuth() {
  // Decide on the real NPM_TOKEN secret only — NODE_AUTH_TOKEN is always set to a
  // placeholder by setup-node and must not be treated as a real credential.
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

  // No token: use OIDC trusted publishing (needs id-token: write + npm >= 11.5.1).
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    clearNpmrcAuth();
    console.log("No NPM_TOKEN — publishing via npm OIDC trusted publishing.");
    return;
  }

  console.error(`
npm authentication is not configured.

Set ONE of:
  1. NPM_TOKEN repo secret — npm token with WRITE access to @vgabriel45 (Automation token recommended)
  2. npm OIDC trusted publishing — @vgabriel45/demo-sdk → Settings → Trusted Publisher:
       owner: VGabriel45
       repo:  trails-release-pipeline-sandbox
       workflow: release-publish.yml
     (needs "id-token: write" in the workflow and no NPM_TOKEN set)
`);
  process.exit(1);
}

run('git config user.name "trails-sdk-release-bot[bot]"');
run(
  'git config user.email "4181013+trails-sdk-release-bot[bot]@users.noreply.github.com"',
);

ensureNpmAuth();
run("pnpm exec changeset publish");
run("git push --follow-tags origin production");

const ghToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const tags = execSync("git tag --sort=-creatordate", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .slice(0, 5);

for (const tag of tags) {
  try {
    execSync(`gh release view "${tag}"`, { stdio: "pipe", env: { ...process.env, GH_TOKEN: ghToken } });
  } catch {
    run(`gh release create "${tag}" --generate-notes`, { GH_TOKEN: ghToken });
  }
}

console.log("Publish complete.");
