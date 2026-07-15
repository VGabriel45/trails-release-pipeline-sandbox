import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const NPM_REGISTRY_URL = "https://registry.npmjs.org"

function npmrcPath() {
  return process.env.NPM_CONFIG_USERCONFIG || join(homedir(), ".npmrc")
}

// setup-node writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` and a
// placeholder NODE_AUTH_TOKEN. For OIDC that empty/placeholder token shadows the
// trusted-publisher flow, so we strip the auth line and unset the placeholder.
function clearNpmrcAuth() {
  delete process.env.NODE_AUTH_TOKEN
  const path = npmrcPath()
  if (!existsSync(path)) return
  const cleaned = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.includes("_authToken"))
    .join("\n")
  writeFileSync(path, cleaned)
}

function normalizeRegistry(url) {
  return String(url ?? "")
    .trim()
    .replace(/\/+$/, "")
}

function assertNpmRegistryPinned() {
  const allowed = normalizeRegistry(NPM_REGISTRY_URL)
  const files = [join(process.cwd(), ".npmrc"), npmrcPath()]
  for (const path of files) {
    if (!existsSync(path)) continue
    const lines = readFileSync(path, "utf8").split("\n")
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith("#") || line.startsWith(";")) continue
      const match = line.match(/^(?:@[^:\s]+:)?registry\s*=\s*(\S+)\s*$/i)
      if (!match) continue
      if (normalizeRegistry(match[1]) === allowed) continue
      throw new Error(
        `Refusing to publish: non-npm registry override in ${path}: ${line}. Registry must be ${NPM_REGISTRY_URL}.`,
      )
    }
  }
}

/** @param {{ workflows?: string[] }} [options] */
export function ensureNpmAuth(options = {}) {
  const workflows = options.workflows ?? ["release-publish.yml"]
  const workflowList = workflows.map((w) => `       workflow: ${w}`).join("\n")

  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    clearNpmrcAuth()
    assertNpmRegistryPinned()
    console.log("Publishing via npm OIDC trusted publishing.")
    return
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "<owner>/<repo>"
  console.error(`
npm authentication is not configured.

This pipeline is OIDC-only. Configure npm trusted publishing on each package:
  repo:     ${repo}
${workflowList}
(needs "id-token: write" in the workflow)
`)
  process.exit(1)
}
