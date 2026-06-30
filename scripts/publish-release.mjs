import { execSync } from "node:child_process";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

function execOut(cmd, env = process.env) {
  return execSync(cmd, { encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

function ensureNpmAuth() {
  // A non-empty NPM_TOKEN takes precedence (token-based publish).
  if (process.env.NPM_TOKEN) {
    process.env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
  }

  if (process.env.NODE_AUTH_TOKEN) {
    try {
      const whoami = execOut("npm whoami --registry=https://registry.npmjs.org");
      console.log(`npm authenticated via token as: ${whoami}`);
    } catch {
      console.error("npm whoami failed — NPM_TOKEN is present but not valid.");
      process.exit(1);
    }
    return;
  }

  // No token: fall back to OIDC trusted publishing.
  // Requires id-token: write permission + a trusted publisher configured on npm.
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    console.log("No NPM_TOKEN — using npm OIDC trusted publishing.");
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
