import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { filterChangesetsByPackage } from "./lib/filter-changesets.mjs";
import { ensureNpmAuth } from "./lib/npm-auth.mjs";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

function hasPendingChangesets() {
  try {
    const out = execSync('ls .changeset/*.md 2>/dev/null || true', {
      encoding: "utf8",
      shell: "/bin/bash",
    }).trim();
    return out.length > 0;
  } catch {
    return existsSync(".changeset");
  }
}

try {
  filterChangesetsByPackage(process.env.RELEASE_PACKAGES ?? "all");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (!hasPendingChangesets()) {
  console.error("No pending changesets after filtering.");
  process.exit(1);
}

process.env.CHANGESET_SNAPSHOT = "1";
run("pnpm exec changeset version --snapshot canary");

ensureNpmAuth();
run("pnpm exec changeset publish --no-git-tag --tag canary");

console.log("Canary publish complete.");
