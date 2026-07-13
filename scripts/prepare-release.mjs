import { execFileSync, execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterChangesetsByPackage,
  restoreHeldChangesets,
} from "./lib/filter-changesets.mjs";
import { getPublishablePackageEntries } from "./lib/packages.mjs";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

function execOut(cmd, env = process.env) {
  return execSync(cmd, {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

// Shell-free variants for commands that carry repo-controlled data (package
// names/versions, PR titles/bodies). Argv arrays never pass through a shell,
// so metacharacters in the data are inert.
function runFile(cmd, args, env = process.env) {
  execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
}

function execFileOut(cmd, args, env = process.env) {
  return execFileSync(cmd, args, {
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

function shortName(name) {
  return name.includes("/") ? name.split("/").pop() : name;
}

// Version of a package on origin/production (null if it isn't there yet).
function productionVersion(pkgDir) {
  try {
    const raw = execFileOut("git", ["show", `origin/production:${pkgDir}/package.json`]);
    return JSON.parse(raw).version;
  } catch {
    return null;
  }
}

// The set of publishable packages whose current (master) version differs from
// origin/production — i.e. exactly what this release will publish. Monorepo-aware:
// each package keeps its own independent version.
function releasedPackages() {
  return publishablePackages()
    .filter((p) => productionVersion(p.dir) !== p.version)
    .map((p) => ({ name: p.name, version: p.version }));
}

function releaseTitle(released) {
  if (released.length === 1) return `Release v${released[0].version}`;
  return `Release: ${released.map((p) => `${shortName(p.name)}@${p.version}`).join(", ")}`;
}

function releaseBody(released) {
  const lines = released.map((p) => `- ${p.name}@${p.version}`).join("\n");
  return `Automated release PR from the release-prepare workflow.\n\n${lines}`;
}

function commitMessage(released) {
  if (released.length === 1) return `chore(release): v${released[0].version}`;
  return `chore(release): ${released
    .map((p) => `${shortName(p.name)}@${p.version}`)
    .join(", ")}`;
}

function publishablePackages() {
  return getPublishablePackageEntries();
}

// While a package is pre-1.0 (version 0.x) we don't follow strict semver yet:
// a `major` bump would jump to 1.0.0, which we don't want during early dev.
// Rewrite `major` -> `minor` in pending changesets for any 0.x package so the
// second digit moves instead (e.g. 0.2.0 -> 0.3.0). Lifted automatically once a
// package reaches 1.x. To ship a specific version (e.g. 1.0.0), set it in
// package.json on master before running prepare.
function capPre1MajorBumps() {
  const majorByName = new Map(
    publishablePackages().map((p) => [
      p.name,
      Number(String(p.version).split(".")[0]),
    ]),
  );

  let capped = false;
  for (const file of readdirSync(".changeset")) {
    if (!file.endsWith(".md")) continue;
    const path = join(".changeset", file);
    const raw = readFileSync(path, "utf8");
    const updated = raw.replace(
      /^("[^"]+"|[^\s:]+):[ \t]*major[ \t]*$/gim,
      (line, nameToken) => {
        const name = nameToken.replace(/"/g, "");
        if (majorByName.get(name) === 0) {
          capped = true;
          return `${nameToken}: minor`;
        }
        return line;
      },
    );
    if (updated !== raw) writeFileSync(path, updated);
  }

  if (capped) {
    console.log(
      "Pre-1.0: capped 'major' bumps to 'minor' (no automatic 1.0.0).",
    );
  }
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

// Configure the committer as the release bot. Portable: derives the identity
// from the app slug (APP_SLUG, set by the workflow from create-github-app-token)
// and falls back to github-actions[bot] when not running as an app.
function configureGitBot() {
  const slug = (process.env.APP_SLUG ?? "").trim();
  if (slug) {
    let userId = "";
    try {
      userId = execFileOut("gh", ["api", `/users/${slug}[bot]`, "--jq", ".id"]);
    } catch {
      // fall through to github-actions[bot]
    }
    if (userId) {
      runFile("git", ["config", "user.name", `${slug}[bot]`]);
      runFile("git", [
        "config",
        "user.email",
        `${userId}+${slug}[bot]@users.noreply.github.com`,
      ]);
      return;
    }
  }
  runFile("git", ["config", "user.name", "github-actions[bot]"]);
  runFile("git", [
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
}

function openReleasePr(title, body, ghToken) {
  const env = { ...process.env, GH_TOKEN: ghToken };

  const existing = execOut(
    'gh pr list --base production --head master --state open --json url --jq ".[0].url // empty"',
    env,
  );

  if (existing) {
    console.log(`Release PR already open: ${existing}`);
    return existing;
  }

  const prUrl = execFileOut(
    "gh",
    ["pr", "create", "--base", "production", "--head", "master", "--title", title, "--body", body],
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

try {
  filterChangesetsByPackage(process.env.RELEASE_PACKAGES ?? "all");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

let released;

if (hasPendingChangesets()) {
  capPre1MajorBumps();

  console.log("Pending changesets found — running changeset version…");
  try {
    runChangesetVersionWithRetry();
  } finally {
    restoreHeldChangesets();
  }

  released = releasedPackages();
  if (released.length === 0) {
    throw new Error("changeset version ran but no package versions changed.");
  }
  console.log(
    `Releasing: ${released.map((p) => `${p.name}@${p.version}`).join(", ")}`,
  );

  configureGitBot();
  run("git add -A");
  runFile("git", ["commit", "-m", commitMessage(released)]);
  run("git push origin master");
} else if (masterAheadOfProduction()) {
  released = releasedPackages();
  if (released.length === 0) {
    console.error(
      "Master is ahead of production but no publishable package versions differ.",
    );
    process.exit(1);
  }
  console.log(
    `No pending changesets (already consumed). Master is ahead of production — opening release PR only for: ${released
      .map((p) => `${p.name}@${p.version}`)
      .join(", ")}`,
  );
} else {
  console.error(
    "Nothing to release: no pending changesets on master and master matches production.",
  );
  console.error("Merge feature PRs with changesets first, then run prepare again.");
  process.exit(1);
}

openReleasePr(releaseTitle(released), releaseBody(released), ghToken);
