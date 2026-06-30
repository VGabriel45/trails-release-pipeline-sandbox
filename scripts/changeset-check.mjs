import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packagesFromChangedFiles, repoRoot } from "./lib/packages.mjs";
import { parseBumpToken } from "./lib/bump-token.mjs";

const ROOT = repoRoot();
const PR_NUMBER = process.env.PR_NUMBER;
const PR_TITLE = process.env.PR_TITLE ?? "";
const PR_BODY = process.env.PR_BODY ?? "";

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

const { skip, bump } = parseBumpToken(PR_TITLE, PR_BODY);
if (skip) {
  console.log("skip-changeset — pass.");
  process.exit(0);
}

const changesetPath = join(ROOT, ".changeset", `pr-${PR_NUMBER}.md`);
if (!bump) {
  console.error(
    "FAIL: add [patch], [minor], or [major] to the PR title or description.",
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
