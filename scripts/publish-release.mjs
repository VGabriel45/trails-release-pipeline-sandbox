import { execFileSync, execSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureNpmAuth } from "./lib/npm-auth.mjs";
import {
  assertIgnoredPackagesArePrivate,
  getPublishablePackageEntries,
} from "./lib/packages.mjs";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

// Shell-free variants for commands that carry repo-controlled data (package
// names/versions). Arguments are passed as an argv array, so shell
// metacharacters in the data are inert.
function runFile(cmd, args, env = process.env) {
  execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
}

function execFileOut(cmd, args, env = process.env) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

function publishablePackages() {
  return getPublishablePackageEntries();
}

// How long (and how often) the fallback registry check polls before giving up.
// npm's read path is eventually consistent and can lag several minutes behind a
// successful publish, so we poll rather than check once.
const NPM_VIEW_POLL_INTERVAL_MS = 30_000;
const NPM_VIEW_POLL_TIMEOUT_MS = 5 * 60_000;

// Fallback confirmation for versions that were NOT freshly published in this
// run (e.g. a retry-production run where `changeset publish` skipped a version
// that a prior run already pushed to npm). Freshly published versions
// deliberately bypass this check (see below): npm's read-after-write
// propagation lag makes `npm view` 404 for minutes after a successful publish,
// so using it as the success gate would produce false negatives. For the
// fallback path we poll every 30s for up to 5 minutes to absorb that lag.
function isPublishedOnNpm(
  pkg,
  { intervalMs = NPM_VIEW_POLL_INTERVAL_MS, timeoutMs = NPM_VIEW_POLL_TIMEOUT_MS } = {},
) {
  const deadline = Date.now() + timeoutMs;
  const intervalSeconds = Math.max(1, Math.round(intervalMs / 1000));
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const out = execFileOut("npm", ["view", `${pkg.name}@${pkg.version}`, "version"]);
      if (out === pkg.version) return true;
    } catch {
      // Not visible on the registry read path yet (or not published at all).
    }
    if (Date.now() + intervalMs > deadline) return false;
    console.log(
      `npm has not surfaced ${pkg.name}@${pkg.version} yet (attempt ${attempt}); re-checking in ${intervalSeconds}s…`,
    );
    run(`sleep ${intervalSeconds}`);
  }
}

// `changeset publish` prints one line per package it actually published:
//   🦋  New tag:  @scope/name@1.2.3
// Parsing these is the authoritative, race-free signal of what shipped — it is
// emitted synchronously by the publish, unlike the eventually-consistent
// `npm view` read path.
const NEW_TAG_RE = /New tag:\s+((?:@[^/\s]+\/)?[^@\s]+)@(\S+)/;
function parsePublishedTags(output) {
  const set = new Set();
  for (const line of String(output).split("\n")) {
    const match = line.match(NEW_TAG_RE);
    if (match) set.add(`${match[1]}@${match[2]}`);
  }
  return set;
}

function tagExists(tag) {
  try {
    execFileOut("git", ["rev-parse", `refs/tags/${tag}^{}`]);
    return true;
  } catch {
    return false;
  }
}

function tagExistsRemote(tag) {
  try {
    const out = execFileOut("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
    return out.length > 0;
  } catch {
    return false;
  }
}

// Tag only the given packages (the set confirmed live on npm). Tagging a
// version that never published would burn the tag: a later retry-production
// run skips packages whose tag already exists, so the version could never be
// republished. Keeping tags in lockstep with npm lets retries heal a partial
// publish.
function ensurePackageTags(pkgs) {
  const tags = [];
  for (const pkg of pkgs) {
    const tag = `${pkg.name}@${pkg.version}`;
    if (!tagExists(tag)) {
      console.log(`Creating missing tag ${tag}`);
      runFile("git", ["tag", "-a", tag, "-m", tag]);
    }
    tags.push(tag);
  }
  return tags;
}

function pushMissingTags(tags) {
  for (const tag of tags) {
    if (tagExistsRemote(tag)) continue;
    runFile("git", ["push", "origin", `refs/tags/${tag}`]);
  }
}

function ensureGitHubReleases(pkgs, ghToken) {
  for (const pkg of pkgs) {
    const tag = `${pkg.name}@${pkg.version}`;
    try {
      execFileSync("gh", ["release", "view", tag], {
        stdio: "pipe",
        env: { ...process.env, GH_TOKEN: ghToken },
      });
      continue;
    } catch {
      // release does not exist yet — create it
    }

    const notes = changelogSection(pkg.name, pkg.version);
    if (notes) {
      const notesFile = join(tmpdir(), `release-notes-${pkg.name.replace(/[^\w.-]+/g, "-")}-${pkg.version}.md`);
      writeFileSync(notesFile, `${notes}\n`);
      runFile(
        "gh",
        ["release", "create", tag, "--title", tag, "--notes-file", notesFile],
        { GH_TOKEN: ghToken },
      );
    } else {
      runFile("gh", ["release", "create", tag, "--generate-notes"], {
        GH_TOKEN: ghToken,
      });
    }
  }
}

// Extract the "## <version>" section from the package's CHANGELOG.md so release
// notes come from the changeset-generated changelog rather than raw PR titles
// (which can contain bump tokens that GitHub auto-links as @mentions).
function changelogSection(pkgName, version) {
  const packagesDir = "packages";
  for (const entry of readdirSync(packagesDir)) {
    const dir = join(packagesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (pkg.name !== pkgName) continue;

    let md;
    try {
      md = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    } catch {
      return null;
    }
    const lines = md.split("\n");
    const start = lines.findIndex((l) => l.trim() === `## ${version}`);
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) {
        end = i;
        break;
      }
    }
    return lines.slice(start + 1, end).join("\n").trim();
  }
  return null;
}

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

configureGitBot();

assertIgnoredPackagesArePrivate();

ensureNpmAuth();

// Capture the publish output (while still echoing it to the CI log) so we can
// read changeset's authoritative per-package result instead of racing the npm
// registry read path.
let publishFailed = false;
let publishOutput = "";
try {
  publishOutput = execSync("pnpm exec changeset publish", {
    encoding: "utf8",
    env: process.env,
  });
} catch (err) {
  publishFailed = true;
  publishOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  console.warn(
    "changeset publish reported errors — reconciling which versions actually reached npm…",
  );
}
process.stdout.write(publishOutput.endsWith("\n") ? publishOutput : `${publishOutput}\n`);

const freshlyPublished = parsePublishedTags(publishOutput);

// Derive the released set. A package counts as released if changeset just
// published it this run (trusted from the "New tag:" output — no registry
// race), or, for retry-production runs where changeset skipped a version a
// prior run already shipped, if the registry confirms it. This keeps
// tags/releases in lockstep with npm while letting a retry heal a partial
// publish, without producing tags/releases for versions that never shipped.
const allPublishable = publishablePackages();
const published = [];
const unpublished = [];
for (const pkg of allPublishable) {
  const id = `${pkg.name}@${pkg.version}`;
  if (freshlyPublished.has(id) || isPublishedOnNpm(pkg)) {
    published.push(pkg);
  } else {
    unpublished.push(pkg);
  }
}

const tags = ensurePackageTags(published);
pushMissingTags(tags);

const ghToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
ensureGitHubReleases(published, ghToken);

if (unpublished.length > 0) {
  publishFailed = true;
  console.error(
    "The following package versions are NOT on npm; no tags or releases were created for them:",
  );
  for (const pkg of unpublished) {
    console.error(`- ${pkg.name}@${pkg.version}`);
  }
  console.error(
    "Re-run Publish release (retry-production) once the cause is fixed to publish and tag them.",
  );
}

if (publishFailed) {
  console.error("Publish finished with npm errors (tags/releases synced for published versions only).");
  process.exit(1);
}

console.log("Publish complete.");
