import { execFileSync, execSync, spawnSync } from "node:child_process"
import {
  parsePackageSelection,
  selectCanaryChangesets,
} from "./lib/filter-changesets.mjs"
import { ensureNpmAuth } from "./lib/npm-auth.mjs"
import {
  assertIgnoredPackagesArePrivate,
  assertPublishRegistryPinnedToNpm,
  getPublishablePackageEntries,
  NPM_REGISTRY_URL,
} from "./lib/packages.mjs"

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } })
}

function canaryVersion(pkgName) {
  try {
    // argv array — no shell, so metacharacters in pkgName are inert.
    const out = execFileSync(
      "npm",
      ["view", pkgName, "dist-tags", "--json", "--registry", NPM_REGISTRY_URL],
      { encoding: "utf8" },
    ).trim()
    const tags = JSON.parse(out)
    return tags?.canary ?? null
  } catch {
    return null
  }
}

function canaryCommit(version) {
  const m = String(version ?? "").match(/-canary-([0-9a-f]{7,40})$/i)
  return m?.[1] ?? null
}

function packageChangedSince(ref, pkgDir) {
  const rev = spawnSync("git", ["rev-parse", "--verify", "-q", ref], {
    stdio: "ignore",
  })
  if (rev.status !== 0) return true

  const diff = spawnSync(
    "git",
    ["diff", "--quiet", `${ref}..HEAD`, "--", pkgDir],
    {
      stdio: "ignore",
    },
  )
  if (diff.status === 0) return false
  if (diff.status === 1) return true
  return true
}

function changedPackagesSinceLastCanary(selected) {
  const entries = new Map(
    getPublishablePackageEntries().map((p) => [p.name, p]),
  )
  const changed = []

  for (const pkgName of selected) {
    const pkg = entries.get(pkgName)
    if (!pkg) {
      changed.push(pkgName)
      continue
    }

    const latest = canaryVersion(pkgName)
    if (!latest) {
      changed.push(pkgName)
      continue
    }

    const lastCanaryRef = canaryCommit(latest)
    if (!lastCanaryRef) {
      changed.push(pkgName)
      continue
    }

    if (packageChangedSince(lastCanaryRef, pkg.dir)) {
      changed.push(pkgName)
    } else {
      console.log(
        `Skipping ${pkgName}: no changes under ${pkg.dir}/ since canary ${latest}.`,
      )
    }
  }

  return changed
}

function selectedPackagesFromInput(raw) {
  const entries = getPublishablePackageEntries()
  const available = entries.map((p) => p.name)
  const allow = parsePackageSelection(raw ?? "all")
  if (!allow) return available
  return available.filter((name) => allow.has(name))
}

function snapshotBumpedPackages() {
  const bumped = []
  for (const pkg of getPublishablePackageEntries()) {
    let beforeVersion = null
    try {
      const raw = execFileSync(
        "git",
        ["show", `HEAD:${pkg.dir}/package.json`],
        {
          encoding: "utf8",
        },
      ).trim()
      beforeVersion = JSON.parse(raw).version ?? null
    } catch {
      // Missing in HEAD (new package) — treat as bumped.
      bumped.push(pkg.name)
      continue
    }
    if (beforeVersion !== pkg.version) bumped.push(pkg.name)
  }
  return bumped
}

assertIgnoredPackagesArePrivate()
assertPublishRegistryPinnedToNpm()

const requestedSet = parsePackageSelection(
  process.env.RELEASE_PACKAGES ?? "all",
)
const selectedPackages = selectedPackagesFromInput(process.env.RELEASE_PACKAGES)
if (selectedPackages.length === 0) {
  console.error("No publishable packages match RELEASE_PACKAGES.")
  process.exit(1)
}

const changedPackages = changedPackagesSinceLastCanary(selectedPackages)
if (changedPackages.length === 0) {
  console.log(
    "No package changes since latest canary releases. Skipping canary publish.",
  )
  process.exit(0)
}

// Reduce the pending changeset set to EXACTLY the changed, selected packages,
// synthesizing entries for any that lack a changeset. This prevents unrelated
// pending changesets from being canary-published and guarantees every changed
// selected package is included.
selectCanaryChangesets(changedPackages)

process.env.CHANGESET_SNAPSHOT = "1"
run("pnpm exec changeset version --snapshot canary")

const bumped = snapshotBumpedPackages()
const unexpected = requestedSet
  ? bumped.filter((name) => !requestedSet.has(name))
  : []
if (requestedSet && unexpected.length > 0) {
  console.error(
    `Selective canary expanded beyond requested packages. Requested: ${[...requestedSet].join(", ")}. Expanded to include: ${unexpected.join(", ")}. Re-run with All modified packages or include these packages explicitly.`,
  )
  process.exit(1)
}

ensureNpmAuth()
run("pnpm exec changeset publish --no-git-tag --tag canary", {
  npm_config_registry: NPM_REGISTRY_URL,
})

console.log("Canary publish complete.")
