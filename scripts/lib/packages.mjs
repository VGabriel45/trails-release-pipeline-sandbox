import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { load as yamlLoad } from "js-yaml"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")

// package.json fields flow into git/gh/npm invocations in the release scripts.
// Reject anything outside the strict npm name / semver grammar so repo content
// can never smuggle shell metacharacters or option-like strings into commands.
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
export const NPM_REGISTRY_URL = "https://registry.npmjs.org"

export function assertSafePackageMetadata(name, version, source) {
  if (typeof name !== "string" || !NPM_NAME_RE.test(name)) {
    throw new Error(
      `Refusing to release: invalid package name in ${source}: ${JSON.stringify(name)}`,
    )
  }
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(
      `Refusing to release: invalid package version in ${source}: ${JSON.stringify(version)}`,
    )
  }
}

/**
 * Candidate package directories (relative to the repo root), derived from the
 * pnpm-workspace.yaml `packages` globs so nested packages (e.g.
 * packages/wallet/adapters/*) are discovered without a hardcoded list.
 * Only literal paths and a trailing "/*" segment are supported.
 */
export function workspacePackageDirs() {
  const workspace = yamlLoad(
    readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"),
  )
  const globs = (workspace?.packages ?? []).filter(
    (g) => typeof g === "string" && !g.startsWith("!"),
  )

  const dirs = new Set()
  for (const glob of globs) {
    if (!glob.includes("*")) {
      dirs.add(glob)
      continue
    }
    if (!glob.endsWith("/*") || glob.slice(0, -2).includes("*")) {
      throw new Error(
        `Unsupported pnpm-workspace.yaml packages glob for release discovery: ${JSON.stringify(glob)} (only literal paths and a trailing "/*" are supported)`,
      )
    }
    const base = glob.slice(0, -2)
    const absBase = join(ROOT, base)
    if (!existsSync(absBase)) continue
    for (const entry of readdirSync(absBase)) {
      if (statSync(join(absBase, entry)).isDirectory()) {
        dirs.add(`${base}/${entry}`)
      }
    }
  }
  return [...dirs].sort()
}

/** @returns {Set<string>} package names from .changeset/config.json ignore list */
export function getIgnoredPackages() {
  const config = JSON.parse(
    readFileSync(join(ROOT, ".changeset/config.json"), "utf8"),
  )
  return new Set(config.ignore ?? [])
}

/** Match a package name against a changeset ignore entry (supports "*" globs). */
function matchesIgnoreEntry(name, entry) {
  if (!entry.includes("*")) return name === entry
  const re = new RegExp(`^${entry.split("*").map(escapeRegExp).join(".*")}$`)
  return re.test(name)
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isIgnored(name, ignored) {
  for (const entry of ignored) {
    if (matchesIgnoreEntry(name, entry)) return true
  }
  return false
}

function readPackageManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"))
  } catch {
    return null
  }
}

/**
 * Guardrail: Changesets `publish` ignores `.changeset/config.json` `ignore`.
 * To prevent publishing a package that this pipeline intentionally ignores for
 * release metadata, require every ignored package to be `private: true`.
 */
export function assertIgnoredPackagesArePrivate() {
  const ignored = getIgnoredPackages()
  if (ignored.size === 0) return

  const nonPrivateIgnored = []
  for (const dir of workspacePackageDirs()) {
    const pkg = readPackageManifest(dir)
    if (!pkg) continue
    if (!isIgnored(pkg.name, ignored)) continue
    if (pkg.private === true) continue
    nonPrivateIgnored.push({ name: pkg.name, path: join(dir, "package.json") })
  }

  if (nonPrivateIgnored.length > 0) {
    const names = nonPrivateIgnored
      .map((p) => `${p.name} (${p.path})`)
      .join(", ")
    throw new Error(
      `Invalid changeset ignore configuration: ignored packages must be private to avoid publish/reconciliation drift. Mark these private or remove them from .changeset/config.json ignore: ${names}`,
    )
  }
}

// Keep publishing and verification pinned to the canonical npm registry.
// Changesets publish follows package.json publishConfig.registry; allowing repo-
// controlled alternate registries would break release metadata guarantees.
export function assertPublishRegistryPinnedToNpm(
  pkgs = getPublishablePackageEntries(),
) {
  for (const pkg of pkgs) {
    const parsed = readPackageManifest(pkg.dir)
    const configured = parsed?.publishConfig?.registry
    if (!configured) continue
    if (String(configured).replace(/\/+$/, "") === NPM_REGISTRY_URL) continue
    throw new Error(
      `Refusing to publish ${pkg.name}: publishConfig.registry must be ${NPM_REGISTRY_URL} (found ${JSON.stringify(configured)} in ${pkg.dir}/package.json).`,
    )
  }
}

/** Walk workspace package dirs and return publishable package metadata (respects private + ignore). */
export function getPublishablePackageEntries() {
  const ignored = getIgnoredPackages()
  const out = []

  for (const dir of workspacePackageDirs()) {
    const pkg = readPackageManifest(dir)
    if (!pkg) continue
    if (pkg.private === true) continue
    if (isIgnored(pkg.name, ignored)) continue
    // Must throw (not be skipped) so a malformed manifest halts the release.
    assertSafePackageMetadata(pkg.name, pkg.version, join(dir, "package.json"))
    out.push({ dir, name: pkg.name, version: pkg.version })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Walk workspace package dirs and return publishable package names. */
export function getPublishablePackages() {
  return getPublishablePackageEntries().map((p) => p.name)
}

/**
 * Map changed file paths to affected publishable package names. Each file is
 * attributed to the deepest package dir that contains it, so a change under
 * packages/wallet/adapters/wagmi/ affects the adapter, not @0xtrails/wallet.
 */
export function packagesFromChangedFiles(changedFiles) {
  const entries = getPublishablePackageEntries()
  const affected = new Set()

  for (const file of changedFiles) {
    let best = null
    for (const entry of entries) {
      if (!file.startsWith(`${entry.dir}/`)) continue
      if (!best || entry.dir.length > best.dir.length) best = entry
    }
    if (best) affected.add(best.name)
  }
  return [...affected].sort()
}

export function repoRoot() {
  return ROOT
}

export function relativePath(absPath) {
  return relative(ROOT, absPath)
}
