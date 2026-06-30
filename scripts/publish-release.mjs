import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

function execOut(cmd, env = process.env) {
  return execSync(cmd, { encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

function npmrcPath() {
  return process.env.NPM_CONFIG_USERCONFIG || join(homedir(), ".npmrc");
}

// setup-node writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` and a
// placeholder NODE_AUTH_TOKEN. For OIDC that empty/placeholder token shadows the
// trusted-publisher flow, so we strip the auth line and unset the placeholder.
function clearNpmrcAuth() {
  delete process.env.NODE_AUTH_TOKEN;
  const path = npmrcPath();
  if (!existsSync(path)) return;
  const cleaned = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.includes("_authToken"))
    .join("\n");
  writeFileSync(path, cleaned);
}

function ensureNpmAuth() {
  // Decide on the real NPM_TOKEN secret only — NODE_AUTH_TOKEN is always set to a
  // placeholder by setup-node and must not be treated as a real credential.
  const token = process.env.NPM_TOKEN;

  if (token) {
    process.env.NODE_AUTH_TOKEN = token;
    try {
      const whoami = execOut("npm whoami --registry=https://registry.npmjs.org");
      console.log(`npm authenticated via token as: ${whoami}`);
    } catch {
      console.error("npm whoami failed — NPM_TOKEN is present but not valid.");
      process.exit(1);
    }
    return;
  }

  // No token: use OIDC trusted publishing (needs id-token: write + npm >= 11.5.1).
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    clearNpmrcAuth();
    console.log("No NPM_TOKEN — publishing via npm OIDC trusted publishing.");
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "<owner>/<repo>";
  console.error(`
npm authentication is not configured.

Set ONE of:
  1. NPM_TOKEN repo secret — npm token with WRITE access to the package scope
     (Automation token recommended).
  2. npm OIDC trusted publishing — on each package's npm Settings → Trusted Publisher:
       repo:     ${repo}
       workflow: release-publish.yml
     (needs "id-token: write" in the workflow and no NPM_TOKEN set)
`);
  process.exit(1);
}

// Split a git tag like "@scope/pkg@1.2.3" or "pkg@1.2.3" into name + version.
function parseTag(tag) {
  const at = tag.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: tag.slice(0, at), version: tag.slice(at + 1) };
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
run("pnpm exec changeset publish");
run("git push --follow-tags origin production");

const ghToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const tags = execSync("git tag --sort=-creatordate", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .slice(0, 5);

for (const tag of tags) {
  try {
    execSync(`gh release view "${tag}"`, {
      stdio: "pipe",
      env: { ...process.env, GH_TOKEN: ghToken },
    });
    continue;
  } catch {
    // release does not exist yet — create it
  }

  const parsed = parseTag(tag);
  const notes = parsed ? changelogSection(parsed.name, parsed.version) : null;

  if (notes) {
    const notesFile = join(tmpdir(), `release-notes-${parsed.version}.md`);
    writeFileSync(notesFile, `${notes}\n`);
    run(
      `gh release create "${tag}" --title "${tag}" --notes-file "${notesFile}"`,
      { GH_TOKEN: ghToken },
    );
  } else {
    run(`gh release create "${tag}" --generate-notes`, { GH_TOKEN: ghToken });
  }
}

console.log("Publish complete.");
