import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterChangesetsByPackage,
  restoreHeldChangesets,
} from "./lib/filter-changesets.mjs";

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

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

function shortName(name) {
  return name.includes("/") ? name.split("/").pop() : name;
}

// Version of a package on origin/production (null if it isn't there yet).
function productionVersion(pkgDir) {
  try {
    const raw = execOut(`git show origin/production:${pkgDir}/package.json`);
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

// Parse the release_as override input. Accepts either a single semver
// (applied to every publishable package — convenient for single-package repos)
// or a list of "name@x.y.z" pairs for per-package overrides in a monorepo.
function parseReleaseAs(input) {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;
  if (SEMVER_RE.test(trimmed)) return { all: trimmed };

  const byName = new Map();
  for (const part of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const at = part.lastIndexOf("@");
    if (at <= 0) {
      throw new Error(`Invalid release_as entry: "${part}" (expected name@x.y.z)`);
    }
    const name = part.slice(0, at);
    const ver = part.slice(at + 1);
    if (!SEMVER_RE.test(ver)) {
      throw new Error(`Invalid version in release_as entry: "${part}"`);
    }
    byName.set(name, ver);
  }
  return { byName };
}

function publishablePackages() {
  const out = [];
  for (const entry of readdirSync("packages")) {
    const dir = join("packages", entry);
    if (!statSync(dir).isDirectory()) continue;
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.private === true) continue;
      out.push({ dir, name: pkg.name, version: pkg.version });
    } catch {
      // ignore dirs without a valid package.json
    }
  }
  return out;
}

// While a package is pre-1.0 (version 0.x) we don't follow strict semver yet:
// a `major` bump would jump to 1.0.0, which we don't want during early dev.
// Rewrite `major` -> `minor` in pending changesets for any 0.x package so the
// second digit moves instead (e.g. 0.2.0 -> 0.3.0). Lifted automatically once a
// package reaches 1.x, or overridden explicitly via release_as.
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
      "Pre-1.0: capped 'major' bumps to 'minor' (no automatic 1.0.0). Use release_as to override.",
    );
  }
}

// Apply the release_as override after `changeset version` has run. For each
// package that has an override, rewrite package.json to the target version and
// relabel the changelog header that changeset just wrote (auto -> target).
// `autoVersions` maps package name -> the version changeset produced.
function forceVersion(spec, autoVersions) {
  for (const p of publishablePackages()) {
    const target = spec.all ?? spec.byName?.get(p.name);
    if (!target) continue; // no override for this package — keep changeset's version

    const pkgPath = join(p.dir, "package.json");
    const pkgRaw = readFileSync(pkgPath, "utf8");
    writeFileSync(
      pkgPath,
      pkgRaw.replace(/("version":\s*)"[^"]+"/, `$1"${target}"`),
    );

    const autoVersion = autoVersions.get(p.name);
    if (autoVersion && autoVersion !== target) {
      const changelogPath = join(p.dir, "CHANGELOG.md");
      try {
        const md = readFileSync(changelogPath, "utf8");
        writeFileSync(
          changelogPath,
          md.replace(`## ${autoVersion}`, `## ${target}`),
        );
      } catch {
        // no CHANGELOG for this package
      }
    }
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
      userId = execOut(`gh api "/users/${slug}[bot]" --jq .id`);
    } catch {
      // fall through to github-actions[bot]
    }
    if (userId) {
      run(`git config user.name "${slug}[bot]"`);
      run(
        `git config user.email "${userId}+${slug}[bot]@users.noreply.github.com"`,
      );
      return;
    }
  }
  run('git config user.name "github-actions[bot]"');
  run(
    'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
  );
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

  const prUrl = execOut(
    `gh pr create --base production --head master --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}`,
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

const releaseAs = parseReleaseAs(process.env.RELEASE_AS);

let released;

if (hasPendingChangesets()) {
  // Explicit override wins; otherwise apply the pre-1.0 cap.
  if (!releaseAs) capPre1MajorBumps();

  console.log("Pending changesets found — running changeset version…");
  try {
    runChangesetVersionWithRetry();
  } finally {
    restoreHeldChangesets();
  }

  if (releaseAs) {
    const autoVersions = new Map(
      publishablePackages().map((p) => [p.name, p.version]),
    );
    forceVersion(releaseAs, autoVersions);
    console.log("release_as override applied.");
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
  run(`git commit -m ${JSON.stringify(commitMessage(released))}`);
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
