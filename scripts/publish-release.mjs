import { execSync } from "node:child_process";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

function execOut(cmd, env = process.env) {
  return execSync(cmd, { encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

function ensureNpmAuth() {
  // Prefer explicit NPM_TOKEN secret (sandbox / first-time setup).
  if (process.env.NPM_TOKEN) {
    process.env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
  }

  if (!process.env.NODE_AUTH_TOKEN) {
    console.error(`
npm authentication is not configured.

Set ONE of:
  1. NPM_TOKEN repo secret — npm automation token (quickest for sandbox)
  2. npm OIDC trusted publishing (after first publish) — @vgabriel45/demo-sdk → Trusted Publisher:
       owner: VGabriel45
       repo:  trails-release-pipeline-sandbox
       workflow: release-publish.yml

First publish of a new scoped package requires NPM_TOKEN — OIDC is configured on npm after the package exists.
Do NOT set NODE_AUTH_TOKEN to an empty NPM_TOKEN — that disables OIDC.
`);
    process.exit(1);
  }

  try {
    const whoami = execOut("npm whoami --registry=https://registry.npmjs.org");
    console.log(`npm authenticated as: ${whoami}`);
  } catch {
    console.error("npm whoami failed — token/OIDC is present but not valid for npm publish.");
    process.exit(1);
  }
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
