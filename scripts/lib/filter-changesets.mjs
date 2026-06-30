import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const CHANGESET_DIR = ".changeset";
const HELD_DIR = ".release-held";
const PKG_LINE = /^("[^"]+"|[^\s:#]+):\s*(patch|minor|major)\s*$/i;

/** @returns {null | Set<string>} null = include all packages in pending changesets */
export function parsePackageSelection(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "all" || lower === "all modified packages") return null;
  return new Set(
    trimmed
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function parseChangesetFile(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const packages = [];
  for (const line of match[1].split("\n")) {
    const m = line.match(PKG_LINE);
    if (m) {
      packages.push({
        line,
        name: m[1].replace(/"/g, ""),
        bump: m[2].toLowerCase(),
      });
    }
  }
  return { packages, body: match[2].trimEnd() };
}

function serializeChangeset(packages, body) {
  const frontmatter = packages.map((p) => p.line).join("\n");
  const summary = body ? `\n${body}\n` : "\n";
  return `---\n${frontmatter}\n---${summary}`;
}

/** Package names referenced in any pending changeset file. */
export function packagesInPendingChangesets(dir = CHANGESET_DIR) {
  if (!existsSync(dir)) return [];
  const names = new Set();
  for (const file of listPendingChangesetFiles(dir)) {
    const parsed = parseChangesetFile(readFileSync(join(dir, file), "utf8"));
    if (!parsed) continue;
    for (const pkg of parsed.packages) names.add(pkg.name);
  }
  return [...names].sort();
}

function listPendingChangesetFiles(dir = CHANGESET_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md"));
}

function ensureHeldDir() {
  if (!existsSync(HELD_DIR)) mkdirSync(HELD_DIR, { recursive: true });
}

/** Put back changesets that were held while releasing a subset of packages. */
export function restoreHeldChangesets() {
  if (!existsSync(HELD_DIR)) return;
  for (const file of readdirSync(HELD_DIR)) {
    const from = join(HELD_DIR, file);
    const to = join(CHANGESET_DIR, file);
    renameSync(from, to);
  }
  console.log("Restored held changesets for packages not in this release.");
}

/**
 * Limit pending changesets to selected package(s). When selection is null/“all”,
 * leaves files unchanged. Unselected files are moved to `.release-held/` so
 * they survive `changeset version` — call restoreHeldChangesets() after version
 * when committing to master (not needed for ephemeral canary runs).
 */
export function filterChangesetsByPackage(selection, dir = CHANGESET_DIR) {
  const allow = parsePackageSelection(selection);

  if (!existsSync(dir)) {
    throw new Error("No .changeset directory found.");
  }

  const pendingBefore = packagesInPendingChangesets(dir);
  if (pendingBefore.length === 0) {
    throw new Error("No pending changesets found.");
  }

  if (!allow) {
    console.log(`Including all modified packages: ${pendingBefore.join(", ")}`);
    return pendingBefore;
  }

  const unknown = [...allow].filter((name) => !pendingBefore.includes(name));
  if (unknown.length > 0) {
    console.warn(
      `Note: ${unknown.join(", ")} not in pending changesets (pending: ${pendingBefore.join(", ")}).`,
    );
  }

  console.log(`Filtering changesets to: ${[...allow].join(", ")}`);
  ensureHeldDir();

  let keptAny = false;
  for (const file of listPendingChangesetFiles(dir)) {
    const path = join(dir, file);
    const raw = readFileSync(path, "utf8");
    const parsed = parseChangesetFile(raw);
    if (!parsed) continue;

    const kept = parsed.packages.filter((pkg) => allow.has(pkg.name));
    if (kept.length === 0) {
      renameSync(path, join(HELD_DIR, file));
      console.log(`Held ${file} for a future release.`);
      continue;
    }

    keptAny = true;
    if (kept.length < parsed.packages.length) {
      writeFileSync(join(HELD_DIR, file), raw);
      writeFileSync(path, serializeChangeset(kept, parsed.body));
      console.log(`Trimmed ${file} to: ${kept.map((p) => p.name).join(", ")}`);
    }
  }

  const pendingAfter = packagesInPendingChangesets(dir);
  if (!keptAny || pendingAfter.length === 0) {
    restoreHeldChangesets();
    throw new Error(
      `No pending changesets left after filtering to: ${[...allow].join(", ")}`,
    );
  }

  console.log(`Will release: ${pendingAfter.join(", ")}`);
  return pendingAfter;
}

/** Drop held changesets without restoring (canary runner is ephemeral). */
export function discardHeldChangesets() {
  if (!existsSync(HELD_DIR)) return;
  for (const file of readdirSync(HELD_DIR)) {
    unlinkSync(join(HELD_DIR, file));
  }
}
