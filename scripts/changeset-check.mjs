import { execSync } from "node:child_process";
import { packagesFromChangedFiles } from "./lib/packages.mjs";
import { manualChangesetFiles } from "./lib/manual-changesets.mjs";

const PR_NUMBER = process.env.PR_NUMBER;
const PR_LABELS = (process.env.PR_LABELS ?? "")
  .split(",")
  .map((l) => l.trim())
  .filter(Boolean);

function isSkipChangeset() {
  if (PR_LABELS.some((l) => l.toLowerCase() === "skip-changeset")) {
    return true;
  }
  const title = process.env.PR_TITLE ?? "";
  const body = process.env.PR_BODY ?? "";
  return /\[skip-changeset\]/i.test(`${title}\n${body}`);
}

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

if (isSkipChangeset()) {
  console.log("skip-changeset (token or label) — pass.");
  process.exit(0);
}

const manual = manualChangesetFiles(changedFiles, PR_NUMBER);
if (manual.length > 0) {
  console.log(`PASS: manual changeset present (${manual.join(", ")}).`);
  process.exit(0);
}

console.error(
  "FAIL: publishable package changes require a manual .changeset/*.md file,\n" +
    "or a 'skip-changeset' label ([skip-changeset] token also supported) for internal-only changes.",
);
process.exit(1);
