import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

function execOut(cmd, env = process.env) {
  return execSync(cmd, {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

function runChangesetVersionWithRetry(maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      run("pnpm exec changeset version");
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
    throw new Error("No publishable package version found on master");
  }

  return versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
}

function hasPendingChangesets() {
  const pending = execOut('ls .changeset/*.md 2>/dev/null || true', {
    shell: "/bin/bash",
  });
  return pending.length > 0;
}

function masterAheadOfProduction() {
  const count = execOut("git rev-list --count origin/production..origin/master");
  return Number(count) > 0;
}

function configureGitBot() {
  run('git config user.name "trails-sdk-release-bot[bot]"');
  run(
    'git config user.email "4181013+trails-sdk-release-bot[bot]@users.noreply.github.com"',
  );
}

function openReleasePr(version, ghToken) {
  const env = { ...process.env, GH_TOKEN: ghToken };

  const existing = execOut(
    'gh pr list --base production --head master --state open --json url --jq ".[0].url // empty"',
    env,
  );

  if (existing) {
    console.log(`Release PR already open: ${existing}`);
    return existing;
  }

  const prUrl = execOut(
    `gh pr create --base production --head master --title "Release v${version}" --body "Automated release PR from release-prepare workflow."`,
    env,
  );

  console.log(`Release PR: ${prUrl}`);
  return prUrl;
}

run("git fetch origin master production");
run("git checkout master");
run("git pull origin master");

const ghToken = process.env.GH_TOKEN ?? process.env.RELEASE_PUSH_TOKEN;
if (!ghToken) {
  throw new Error("GH_TOKEN (app token) is required to open the release PR");
}

// @changesets/changelog-github resolves PR links/authors via the GitHub API.
process.env.GITHUB_TOKEN ??= ghToken;

let version;

if (hasPendingChangesets()) {
  console.log("Pending changesets found — running changeset version…");
  runChangesetVersionWithRetry();
  version = readReleaseVersion();
  console.log(`Release version: ${version}`);

  configureGitBot();
  run("git add -A");
  run(`git commit -m "chore(release): v${version}"`);
  run("git push origin master");
} else if (masterAheadOfProduction()) {
  version = readReleaseVersion();
  console.log(
    `No pending changesets (already consumed). Master is ahead of production at v${version} — opening release PR only.`,
  );
} else {
  console.error(
    "Nothing to release: no pending changesets on master and master matches production.",
  );
  console.error("Merge feature PRs with changesets first, then run prepare again.");
  process.exit(1);
}

openReleasePr(version, ghToken);
