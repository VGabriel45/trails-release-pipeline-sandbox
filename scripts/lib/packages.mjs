import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** @returns {Set<string>} package names from .changeset/config.json ignore list */
export function getIgnoredPackages() {
  const config = JSON.parse(
    readFileSync(join(ROOT, ".changeset/config.json"), "utf8"),
  );
  return new Set(config.ignore ?? []);
}

/** Walk packages/* and return publishable package names. */
export function getPublishablePackages() {
  const ignored = getIgnoredPackages();
  const names = [];
  const packagesDir = join(ROOT, "packages");

  for (const entry of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, entry);
    if (!statSync(pkgDir).isDirectory()) continue;
    const pkgPath = join(pkgDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.private === true) continue;
    if (ignored.has(pkg.name)) continue;
    names.push(pkg.name);
  }
  return names.sort();
}

/** Map changed file paths to affected publishable package names. */
export function packagesFromChangedFiles(changedFiles) {
  const publishable = new Set(getPublishablePackages());
  const affected = new Set();

  for (const file of changedFiles) {
    const match = file.match(/^packages\/([^/]+)\//);
    if (!match) continue;
    const pkgPath = join(ROOT, "packages", match[1], "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (publishable.has(pkg.name)) affected.add(pkg.name);
    } catch {
      // ignore missing package.json
    }
  }
  return [...affected].sort();
}

export function repoRoot() {
  return ROOT;
}

export function relativePath(absPath) {
  return relative(ROOT, absPath);
}
