import { execSync } from "node:child_process";
import { ensureNpmAuth } from "./lib/npm-auth.mjs";

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

// OIDC trusted publishers are matched by workflow filename — canary needs its own
// npm Trusted Publisher entry (or an NPM_TOKEN with scope publish access).
ensureNpmAuth({ workflows: ["release-canary.yml", "release-publish.yml"] });
run("pnpm exec changeset publish --no-git-tag --tag canary");

console.log("Canary publish complete.");
