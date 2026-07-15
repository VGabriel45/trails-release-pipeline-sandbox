#!/usr/bin/env node
/**
 * Check all package.json files in the repository (excluding node_modules) to ensure
 * dependency and devDependency version specifiers do NOT use caret (^) or tilde (~).
 * Exits with code 1 and prints offending files/dependencies if any violations found.
 */

const fs = require("node:fs")
const path = require("node:path")

const repoRoot = path.resolve(__dirname, "..")

/** Recursively collect package.json file paths excluding anything under node_modules. */
function collectPackageJsonFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      collectPackageJsonFiles(fullPath, results)
    } else if (entry.isFile() && entry.name === "package.json") {
      results.push(fullPath)
    }
  }
  return results
}

/** Validate dependency object and return list of offending specs. */
function findOffenders(depObj) {
  if (!depObj || typeof depObj !== "object") return []
  const offenders = []
  for (const [name, version] of Object.entries(depObj)) {
    if (typeof version === "string" && /^[\^~]/.test(version)) {
      offenders.push({ name, version })
    }
  }
  return offenders
}

function main() {
  const packageFiles = collectPackageJsonFiles(repoRoot)
  let hasErrors = false
  for (const pkgPath of packageFiles) {
    let json
    try {
      const raw = fs.readFileSync(pkgPath, "utf8")
      json = JSON.parse(raw)
    } catch (e) {
      console.error(`[ERROR] Failed to parse ${pkgPath}: ${e.message}`)
      hasErrors = true
      continue
    }
    const depOffenders = findOffenders(json.dependencies)
    const devDepOffenders = findOffenders(json.devDependencies)
    if (depOffenders.length || devDepOffenders.length) {
      hasErrors = true
      console.error(`\n[VERSION SPEC VIOLATION] ${pkgPath}`)
      if (depOffenders.length) {
        console.error("  dependencies:")
        for (const o of depOffenders) {
          console.error(`    - ${o.name}: ${o.version}`)
        }
      }
      if (devDepOffenders.length) {
        console.error("  devDependencies:")
        for (const o of devDepOffenders) {
          console.error(`    - ${o.name}: ${o.version}`)
        }
      }
    }
  }
  if (hasErrors) {
    console.error("\nStrict version check failed: remove ^ or ~ specifiers.")
    process.exit(1)
  } else {
    console.log("All package.json dependencies use strict pinned versions.")
    process.exit(0)
  }
}

if (require.main === module) {
  main()
}
