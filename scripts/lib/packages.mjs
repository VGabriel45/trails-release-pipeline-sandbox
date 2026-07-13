import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

// package.json fields flow into git/gh/npm invocations in the release scripts.
// Reject anything outside the strict npm name / semver grammar so repo content
// can never smuggle shell metacharacters or option-like strings into commands.
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const NPM_REGISTRY_URL = "https://registry.npmjs.org";

export function assertSafePackageMetadata(name, version, source) {
  if (typeof name !== "string" || !NPM_NAME_RE.test(name)) {
    throw new Error(
      `Refusing to release: invalid package name in ${source}: ${JSON.stringify(name)}`,
    );
  }
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(
      `Refusing to release: invalid package version in ${source}: ${JSON.stringify(version)}`,
    );
  }
}

/** @returns {Set<string>} package names from .changeset/config.json ignore list */
export function getIgnoredPackages() {
  const config = JSON.parse(
    readFileSync(join(ROOT, ".changeset/config.json"), "utf8"),
  );
  return new Set(config.ignore ?? []);
}

/**
 * Guardrail: Changesets `publish` ignores `.changeset/config.json` `ignore`.
 * To prevent publishing a package that this pipeline intentionally ignores for
 * release metadata, require every ignored package to be `private: true`.
 */
export function assertIgnoredPackagesArePrivate() {
  const ignored = getIgnoredPackages();
  if (ignored.size === 0) return;

  const nonPrivateIgnored = [];
  const packagesDir = join(ROOT, "packages");
  for (const entry of readdirSync(packagesDir)) {
    const dir = join(packagesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const pkgPath = join(dir, "package.json");
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      continue;
    }
    if (!ignored.has(pkg.name)) continue;
    if (pkg.private === true) continue;
    nonPrivateIgnored.push({
      name: pkg.name,
      path: join("packages", entry, "package.json"),
    });
  }

  if (nonPrivateIgnored.length > 0) {
    const names = nonPrivateIgnored.map((p) => `${p.name} (${p.path})`).join(", ");
    throw new Error(
      `Invalid changeset ignore configuration: ignored packages must be private to avoid publish/reconciliation drift. Mark these private or remove them from .changeset/config.json ignore: ${names}`,
    );
  }
}

// Keep publishing and verification pinned to the canonical npm registry.
// Changesets publish follows package.json publishConfig.registry; allowing repo-
// controlled alternate registries would break release metadata guarantees.
export function assertPublishRegistryPinnedToNpm(pkgs = getPublishablePackageEntries()) {
  for (const pkg of pkgs) {
    const path = join(ROOT, pkg.dir, "package.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const configured = parsed?.publishConfig?.registry;
    if (!configured) continue;
    if (String(configured).replace(/\/+$/, "") === NPM_REGISTRY_URL) continue;
    throw new Error(
      `Refusing to publish ${pkg.name}: publishConfig.registry must be ${NPM_REGISTRY_URL} (found ${JSON.stringify(configured)} in ${pkg.dir}/package.json).`,
    );
  }
}
/** Walk packages/* and return publishable package metadata (respects private + ignore). */
export function getPublishablePackageEntries() {
  const ignored = getIgnoredPackages();
  const out = [];
  const packagesDir = join(ROOT, "packages");

  for (const entry of readdirSync(packagesDir)) {
    const dir = join(packagesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const pkgPath = join(dir, "package.json");
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      // ignore dirs without a valid package.json
      continue;
    }
    if (pkg.private === true) continue;
    if (ignored.has(pkg.name)) continue;
    // Must throw (not be skipped) so a malformed manifest halts the release.
    assertSafePackageMetadata(pkg.name, pkg.version, join("packages", entry, "package.json"));
    out.push({ dir: join("packages", entry), name: pkg.name, version: pkg.version });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Walk packages/* and return publishable package names. */
export function getPublishablePackages() {
  return getPublishablePackageEntries().map((p) => p.name);
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
