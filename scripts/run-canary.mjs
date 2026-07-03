import { execSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import {
  filterChangesetsByPackage,
  packagesInPendingChangesets,
  parsePackageSelection,
} from "./lib/filter-changesets.mjs";
import { ensureNpmAuth } from "./lib/npm-auth.mjs";
import { getPublishablePackageEntries } from "./lib/packages.mjs";

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

function execOut(cmd, env = process.env) {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...env },
  }).trim();
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

function canaryVersion(pkgName) {
  try {
    const tags = JSON.parse(execOut(`npm view ${JSON.stringify(pkgName)} dist-tags --json`));
    return tags?.canary ?? null;
  } catch {
    return null;
  }
}

function canaryCommit(version) {
  const m = String(version ?? "").match(/-canary-([0-9a-f]{7,40})$/i);
  return m?.[1] ?? null;
}

function packageChangedSince(ref, pkgDir) {
  const rev = spawnSync("git", ["rev-parse", "--verify", "-q", ref], { stdio: "ignore" });
  if (rev.status !== 0) return true;

  const diff = spawnSync("git", ["diff", "--quiet", `${ref}..HEAD`, "--", pkgDir], {
    stdio: "ignore",
  });
  if (diff.status === 0) return false;
  if (diff.status === 1) return true;
  return true;
}

function changedPackagesSinceLastCanary(selected) {
  const entries = new Map(getPublishablePackageEntries().map((p) => [p.name, p]));
  const changed = [];

  for (const pkgName of selected) {
    const pkg = entries.get(pkgName);
    if (!pkg) {
      changed.push(pkgName);
      continue;
    }

    const latest = canaryVersion(pkgName);
    if (!latest) {
      changed.push(pkgName);
      continue;
    }

    const lastCanaryRef = canaryCommit(latest);
    if (!lastCanaryRef) {
      changed.push(pkgName);
      continue;
    }

    if (packageChangedSince(lastCanaryRef, pkg.dir)) {
      changed.push(pkgName);
    } else {
      console.log(
        `Skipping ${pkgName}: no changes under ${pkg.dir}/ since canary ${latest}.`,
      );
    }
  }

  return changed;
}

function selectedPackagesFromInput(raw) {
  const entries = getPublishablePackageEntries();
  const available = entries.map((p) => p.name);
  const allow = parsePackageSelection(raw ?? "all");
  if (!allow) return available;
  return available.filter((name) => allow.has(name));
}

function writeSyntheticCanaryChangeset(packageNames) {
  if (packageNames.length === 0) return;
  const frontmatter = packageNames
    .map((name) => `"${name}": patch`)
    .join("\n");
  const body = "Synthetic canary snapshot (no pending changesets).";
  const file = ".changeset/canary-snapshot-auto.md";
  writeFileSync(file, `---\n${frontmatter}\n---\n${body}\n`);
  console.log(
    `Created synthetic canary changeset for: ${packageNames.join(", ")}.`,
  );
}

const selectedPackages = selectedPackagesFromInput(process.env.RELEASE_PACKAGES);
if (selectedPackages.length === 0) {
  console.error("No publishable packages match RELEASE_PACKAGES.");
  process.exit(1);
}

const changedPackages = changedPackagesSinceLastCanary(selectedPackages);
if (changedPackages.length === 0) {
  console.log("No package changes since latest canary releases. Skipping canary publish.");
  process.exit(0);
}

const pendingBefore = packagesInPendingChangesets();
if (pendingBefore.length > 0 && changedPackages.length < selectedPackages.length) {
  filterChangesetsByPackage(changedPackages.join(" "));
}

if (!hasPendingChangesets()) {
  writeSyntheticCanaryChangeset(changedPackages);
}

process.env.CHANGESET_SNAPSHOT = "1";
run("pnpm exec changeset version --snapshot canary");

ensureNpmAuth();
run("pnpm exec changeset publish --no-git-tag --tag canary");

console.log("Canary publish complete.");
