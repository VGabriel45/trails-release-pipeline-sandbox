import { execSync } from "node:child_process";
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

function execOut(cmd, env = process.env) {
  return execSync(cmd, { encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

function publishablePackages() {
  return getPublishablePackageEntries();
}

function tagExists(tag) {
  try {
    execOut(`git rev-parse "refs/tags/${tag}^{}"`);
    return true;
  } catch {
    return false;
  }
}

function tagExistsRemote(tag) {
  try {
    const out = execOut(`git ls-remote --tags origin "refs/tags/${tag}"`);
    return out.length > 0;
  } catch {
    return false;
  }
}

// changeset publish only tags packages it publishes in *this* run. After a partial
// failure (one package on npm, another not), retried runs skip already-published
// packages and never create their tags. Ensure every publishable package on
// production has a git tag matching its package.json version.
function ensurePackageTags() {
  const tags = [];
  for (const pkg of publishablePackages()) {
    const tag = `${pkg.name}@${pkg.version}`;
    if (!tagExists(tag)) {
      console.log(`Creating missing tag ${tag}`);
      run(`git tag -a "${tag}" -m "${tag}"`);
    }
    tags.push(tag);
  }
  return tags;
}

function pushMissingTags(tags) {
  for (const tag of tags) {
    if (tagExistsRemote(tag)) continue;
    run(`git push origin "refs/tags/${tag}"`);
  }
}

function ensureGitHubReleases(ghToken) {
  for (const pkg of publishablePackages()) {
    const tag = `${pkg.name}@${pkg.version}`;
    try {
      execSync(`gh release view "${tag}"`, {
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
      run(
        `gh release create "${tag}" --title "${tag}" --notes-file "${notesFile}"`,
        { GH_TOKEN: ghToken },
      );
    } else {
      run(`gh release create "${tag}" --generate-notes`, { GH_TOKEN: ghToken });
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

configureGitBot();

ensureNpmAuth();

let publishFailed = false;
try {
  run("pnpm exec changeset publish");
} catch {
  publishFailed = true;
  console.warn(
    "changeset publish reported errors — continuing to sync tags and GitHub releases…",
  );
}

const tags = ensurePackageTags();
run("git push origin production");
pushMissingTags(tags);

const ghToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
ensureGitHubReleases(ghToken);

if (publishFailed) {
  console.error("Publish finished with npm errors (tags/releases synced where possible).");
  process.exit(1);
}

console.log("Publish complete.");
