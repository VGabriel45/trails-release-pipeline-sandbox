import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

function runChangesetVersionWithRetry(maxAttempts = 3) {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is required for @changesets/changelog-github");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      run("pnpm exec changeset version", { GITHUB_TOKEN: githubToken });
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const waitSec = attempt * 5;
      console.warn(
        `changeset version failed (attempt ${attempt}/${maxAttempts}), retrying in ${waitSec}s…`,
      );
      run(`sleep ${waitSec}`);
    }
  }
}

function readReleaseVersion() {
  const packagesDir = "packages";
  const versions = [];

  for (const entry of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, entry);
    if (!statSync(pkgDir).isDirectory()) continue;
    const pkgPath = join(pkgDir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.private !== true && pkg.version) versions.push(pkg.version);
    } catch {
      // ignore
    }
  }

  if (versions.length === 0) {
    throw new Error("No publishable package version found after changeset version");
  }

  // Prefer highest semver for release title (works for single-package sandbox too).
  return versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
}

run("git fetch origin master");
run("git checkout master");
run("git pull origin master");

const pending = execSync('ls .changeset/*.md 2>/dev/null || true', {
  encoding: "utf8",
  shell: "/bin/bash",
}).trim();

if (!pending) {
  console.error("No pending changesets on master — nothing to release.");
  process.exit(1);
}

console.log("Running changeset version (GITHUB_TOKEN → changelog-github GraphQL)…");
runChangesetVersionWithRetry();

const version = readReleaseVersion();
console.log(`Release version: ${version}`);

run('git config user.name "trails-sdk-release-bot[bot]"');
run(
  'git config user.email "4181013+trails-sdk-release-bot[bot]@users.noreply.github.com"',
);

run("git add -A");
run(`git commit -m "chore(release): v${version}"`);
run("git push origin master");

const ghToken = process.env.GH_TOKEN ?? process.env.RELEASE_PUSH_TOKEN;
if (!ghToken) {
  throw new Error("GH_TOKEN (app token) is required to open the release PR");
}

const prUrl = execSync(
  `gh pr create --base production --head master --title "Release v${version}" --body "Automated release PR from release-prepare workflow."`,
  { encoding: "utf8", env: { ...process.env, GH_TOKEN: ghToken } },
).trim();

console.log(`Release PR: ${prUrl}`);
