// Decides whether a push to production carries publishable version bumps.
// Used by release-publish.yml to skip the publish job for pushes that don't
// change any publishable package version (e.g. branch resets or docs merges).
// Writes `publish=true|false` to $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { getPublishablePackageEntries } from "./lib/packages.mjs"

const before = process.env.BEFORE_SHA
const output = process.env.GITHUB_OUTPUT
const ZERO_SHA = /^0{40}$/

if (!output) {
  throw new Error("GITHUB_OUTPUT env var is required.")
}

if (!before || ZERO_SHA.test(before)) {
  console.log(
    "Production branch creation/reset event detected (before SHA is zero). Skipping publish auto-detection for this push.",
  )
  appendFileSync(output, "publish=false\n")
  process.exit(0)
}

// BEFORE_SHA is interpolated into a git argv below; require a literal commit
// SHA so option-like or ref-expression values can never reach git.
if (!/^[0-9a-f]{40}$/i.test(before)) {
  throw new Error(
    `BEFORE_SHA must be a 40-character commit SHA (got ${JSON.stringify(before)}).`,
  )
}

let shouldPublish = false
const changed = []
for (const pkg of getPublishablePackageEntries()) {
  let previous
  try {
    previous = JSON.parse(
      execFileSync("git", ["show", `${before}:${pkg.dir}/package.json`], {
        encoding: "utf8",
      }),
    )
  } catch {
    // New package or missing prior manifest: publish to be safe.
    shouldPublish = true
    changed.push(`${pkg.name}: <new> -> ${pkg.version}`)
    continue
  }

  if (previous.version !== pkg.version) {
    shouldPublish = true
    changed.push(`${pkg.name}: ${previous.version} -> ${pkg.version}`)
  }
}

if (shouldPublish) {
  console.log("Package version bumps detected:")
  for (const line of changed) console.log(`- ${line}`)
} else {
  console.log(
    "No publishable package version bumps detected in this production push — skipping publish.",
  )
}
appendFileSync(output, `publish=${shouldPublish}\n`)
