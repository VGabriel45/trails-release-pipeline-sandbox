import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  filterChangesetsByPackage,
  parsePackageSelection,
  parseChangesetFile,
  packagesInPendingChangesets,
  restoreHeldChangesets,
  serializeChangeset,
} from "./lib/filter-changesets.mjs";
import {
  assertIgnoredPackagesArePrivate,
  getPublishablePackageEntries,
} from "./lib/packages.mjs";

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

// Map of package name -> current master version, captured before this run's
// `changeset version` so we can tell what THIS run actually bumped.
function currentVersions() {
  return new Map(publishablePackages().map((p) => [p.name, p.version]));
}

// Packages whose version changed during this run (compared to the snapshot
// taken before `changeset version`). This is the true "what this run bumped"
// set — unlike releasedPackages(), which reports cumulative master-vs-production
// drift and so includes bumps from earlier prepare runs whose PR hasn't merged.
function bumpedThisRun(versionsBefore) {
  return publishablePackages()
    .filter((p) => versionsBefore.get(p.name) !== p.version)
    .map((p) => ({ name: p.name, version: p.version }));
}

// Guard against changesets silently widening a selective release (dependency or
// fixed/linked-group expansion). Checks ONLY what this run bumped against the
// admin's explicit selection; "all" selections are unconstrained by design.
function enforceSelectionBoundary(bumped, selectionRaw) {
  const selected = parsePackageSelection(selectionRaw ?? "all");
  if (!selected) return;
  const unexpected = bumped.filter((pkg) => !selected.has(pkg.name));
  if (unexpected.length === 0) return;
  throw new Error(
    `Selective release exceeded requested packages. Requested: ${[...selected].join(", ")}. Expanded to include: ${unexpected
      .map((pkg) => `${pkg.name}@${pkg.version}`)
      .join(", ")}. Re-run with All modified packages or include the expanded packages explicitly.`,
  );
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
    const parsed = parseChangesetFile(raw);
    if (!parsed) continue;
    const updatedPackages = parsed.packages.map((pkg) => {
      if (pkg.bump === "major" && majorByName.get(pkg.name) === 0) {
        capped = true;
        return { ...pkg, bump: "minor" };
      }
      return pkg;
    });
    const updated = serializeChangeset(updatedPackages, parsed.body);
    if (updated !== raw) writeFileSync(path, updated);
  }

  if (capped) {
    console.log(
      "Pre-1.0: capped 'major' bumps to 'minor' (no automatic 1.0.0).",
    );
  }
}

function hasPendingChangesets() {
  return packagesInPendingChangesets().length > 0;
}

function masterAheadOfProduction() {
  const count = execOut("git rev-list --count origin/production..origin/master");
  return Number(count) > 0;
}

function findOpenReleasePr(ghToken) {
  return execOut(
    'gh pr list --base production --head master --state open --json url --jq ".[0].url // empty"',
    { ...process.env, GH_TOKEN: ghToken },
  );
}

// --- In-flight release aggregation -----------------------------------------
//
// When a release PR is already open and NEW changesets land on master, we want
// the same release to absorb them instead of stacking a second bump on top
// (2.4.0 -> 2.5.0). To do that we rebuild the release from the production
// baseline: restore package versions and changelogs to what production has,
// resurrect the changesets that earlier prepare runs consumed, and let the
// normal flow below re-run `changeset version` ONCE over the combined set.
//
// Outcome: if the new changesets fit within the in-flight bump level
// (minor + patch), the version stays the same and the changelog aggregates.
// If a new changeset demands a higher bump (major on top of a minor release),
// the version is re-evaluated upward — exactly semver over the full set.

// Restore every consumed changeset from the release commits that sit between
// production and master. Each prepare run makes exactly one
// "chore(release): …" commit; the parent of that commit holds the changeset
// files as they were before `changeset version` consumed them.
function restoreConsumedChangesets() {
  const releaseCommits = execOut(
    "git log --format=%H --grep='^chore(release):' origin/production..HEAD",
  )
    .split("\n")
    .filter(Boolean)
    .reverse(); // oldest first: its parent has the fullest pre-consumption content

  const restored = new Set();
  for (const sha of releaseCommits) {
    const changed = execFileOut("git", [
      "show",
      "--name-status",
      "--format=",
      sha,
      "--",
      ".changeset",
    ]);
    for (const line of changed.split("\n")) {
      const match = line.match(/^([DM])\t(.+\.md)$/);
      if (!match) continue;
      const [, status, path] = match;
      if (path.endsWith("README.md") || restored.has(path)) continue;
      if (status === "D" && existsSync(path)) {
        // A new changeset reused this filename after the old one was consumed.
        // Keep the new file; the consumed content is unrecoverable by name.
        console.warn(`Skipping restore of ${path}: a newer file exists with that name.`);
        continue;
      }
      const content = execFileSync("git", ["show", `${sha}^:${path}`], {
        encoding: "utf8",
      });
      writeFileSync(path, content);
      restored.add(path);
    }
  }
  if (restored.size > 0) {
    console.log(
      `Restored ${restored.size} changeset(s) consumed by in-flight release commits: ${[...restored].join(", ")}`,
    );
  }
}

// Reset publishable package versions and changelogs to the production
// baseline so `changeset version` recomputes the release from scratch.
function rebuildInFlightReleaseBaseline() {
  console.log(
    "Release PR is open and new changesets landed — rebuilding the release from the production baseline so the same release absorbs them.",
  );

  for (const pkg of publishablePackages()) {
    const prodVersion = productionVersion(pkg.dir);
    if (prodVersion && prodVersion !== pkg.version) {
      const manifestPath = join(pkg.dir, "package.json");
      const raw = readFileSync(manifestPath, "utf8");
      writeFileSync(
        manifestPath,
        raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${prodVersion}$2`),
      );
    }

    const changelogPath = join(pkg.dir, "CHANGELOG.md");
    try {
      const prodChangelog = execFileSync(
        "git",
        ["show", `origin/production:${changelogPath}`],
        { encoding: "utf8" },
      );
      writeFileSync(changelogPath, prodChangelog);
    } catch {
      // Changelog doesn't exist on production — it was created by the
      // in-flight release. Drop it; changeset version will recreate it.
      if (existsSync(changelogPath)) unlinkSync(changelogPath);
    }
  }

  restoreConsumedChangesets();

  if (!hasPendingChangesets()) {
    throw new Error(
      "Rebuild found no changesets to re-version after restoring the production baseline. The in-flight release commits did not consume any recoverable changesets — resolve manually (close the release PR or reset master).",
    );
  }
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

  const existing = findOpenReleasePr(ghToken);

  if (existing) {
    runFile("gh", ["pr", "edit", existing, "--title", title, "--body", body], env);
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

assertIgnoredPackagesArePrivate();

// In-flight release aggregation: when new changesets are pending, master
// already carries staged bumps from an earlier prepare run, AND that release
// PR is still open, rebuild from the production baseline so the same release
// absorbs the new changesets (same version if they fit the in-flight bump
// level; re-evaluated upward if e.g. a major landed on a minor release).
// If the PR was closed, we intentionally do NOT rebuild — a fresh PR stacks
// on top of the existing staged bumps instead.
if (
  hasPendingChangesets() &&
  releasedPackages().length > 0 &&
  findOpenReleasePr(ghToken)
) {
  rebuildInFlightReleaseBaseline();
}

let selectionAlreadyConsumed = false;

// Only filter when changesets actually exist. When none remain — because a
// prior prepare run already consumed them, or an admin bumped a package.json
// version by hand — skip filtering and fall through to the
// masterAheadOfProduction() branch instead of throwing "No pending changesets
// found." (filterChangesetsByPackage throws on an empty set).
if (hasPendingChangesets()) {
  try {
    filterChangesetsByPackage(process.env.RELEASE_PACKAGES ?? "all");
  } catch (err) {
    if (
      err?.message?.startsWith(
        "No pending changesets left after filtering to:",
      )
    ) {
      selectionAlreadyConsumed = true;
      console.warn(
        `${err.message}. Continuing: selected changesets are already consumed; will attempt release PR recovery from master vs production divergence.`,
      );
    } else {
      console.error(err.message);
      process.exit(1);
    }
  }
}

let released;

if (hasPendingChangesets() && !selectionAlreadyConsumed) {
  const versionsBefore = currentVersions();
  capPre1MajorBumps();

  console.log("Pending changesets found — running changeset version…");
  try {
    runChangesetVersionWithRetry();
  } finally {
    restoreHeldChangesets();
  }

  // Boundary check uses THIS run's actual version delta, not master-vs-production
  // (which would count still-unmerged bumps from earlier prepare runs).
  enforceSelectionBoundary(bumpedThisRun(versionsBefore), process.env.RELEASE_PACKAGES);

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
  // No versioning happened this run (changesets already consumed), so there is
  // no per-run delta to bound — the divergence is whatever earlier runs staged.
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
