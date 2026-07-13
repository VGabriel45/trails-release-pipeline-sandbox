import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureNpmAuth } from "./lib/npm-auth.mjs";
import { getPublishablePackageEntries } from "./lib/packages.mjs";

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

// Confirm a specific name@version is actually live on the npm registry. Tags
// and GitHub releases must reflect what published, not merely what the
// manifests claim. `changeset publish` is per-package and can partially fail
// (one package publishes, another doesn't); its failure is caught below, so we
// re-derive the published set from the registry itself. A few retries absorb
// brief read-path propagation lag after a successful publish.
function isPublishedOnNpm(pkg, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const out = execFileOut("npm", ["view", `${pkg.name}@${pkg.version}`, "version"]);
      if (out === pkg.version) return true;
    } catch {
      // Not on the registry yet (or not at all).
    }
    if (attempt < attempts) run(`sleep ${attempt * 2}`);
  }
  return false;
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

ensureNpmAuth();

let publishFailed = false;
try {
  run("pnpm exec changeset publish");
} catch {
  publishFailed = true;
  console.warn(
    "changeset publish reported errors — verifying which versions actually reached npm…",
  );
}

// Derive the released set from the registry, not the manifests, so a partial
// publish never produces tags/releases for versions that didn't ship.
const allPublishable = publishablePackages();
const published = allPublishable.filter((pkg) => isPublishedOnNpm(pkg));
const unpublished = allPublishable.filter((pkg) => !published.includes(pkg));

const tags = ensurePackageTags(published);
run("git push origin production");
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
