import { execSync } from "node:child_process";
import { ensureNpmAuth } from "./lib/npm-auth.mjs";

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

// Canary runs inside release-publish.yml so npm OIDC needs only that workflow.
ensureNpmAuth();
run("pnpm exec changeset publish --no-git-tag --tag canary");

console.log("Canary publish complete.");
