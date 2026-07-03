import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packagesFromChangedFiles, repoRoot } from "./lib/packages.mjs";
import { parseBumpToken } from "./lib/bump-token.mjs";
import { manualChangesetFiles } from "./lib/manual-changesets.mjs";

const ROOT = repoRoot();
const PR_NUMBER = process.env.PR_NUMBER;
const PR_TITLE = process.env.PR_TITLE ?? "";
const PR_BODY = process.env.PR_BODY ?? "";
const PR_LABELS = (process.env.PR_LABELS ?? "")
  .split(",")
  .map((l) => l.trim())
  .filter(Boolean);

const changedFiles = execSync("git diff --name-only origin/master...HEAD", {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const affected = packagesFromChangedFiles(changedFiles);
if (affected.length === 0) {
  console.log("No publishable packages changed — pass.");
  process.exit(0);
}

const { skip, bump } = parseBumpToken(PR_TITLE, PR_BODY, PR_LABELS);
if (skip) {
  console.log("skip-changeset (token or label) — pass.");
  process.exit(0);
}

const manual = manualChangesetFiles(changedFiles, PR_NUMBER);
if (manual.length > 0) {
  console.log(`PASS: manual changeset present (${manual.join(", ")}).`);
  process.exit(0);
}

const changesetPath = join(ROOT, ".changeset", `pr-${PR_NUMBER}.md`);
if (!bump) {
  console.error(
    "FAIL: add [patch], [minor], or [major] to the PR title or description,\n" +
      "add a 'skip-changeset' label (or [skip-changeset] in the title) for internal-only changes,\n" +
      "or commit your own changeset with 'pnpm changeset'.",
  );
  process.exit(1);
}

if (!existsSync(changesetPath)) {
  console.error(
    `FAIL: expected ${changesetPath} — AI changeset workflow may still be running.`,
  );
  process.exit(1);
}

console.log(`PASS: bump=${bump}, changeset exists.`);
