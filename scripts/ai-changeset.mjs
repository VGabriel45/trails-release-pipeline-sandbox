import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { packagesFromChangedFiles, repoRoot } from "./lib/packages.mjs";
import { parseBumpToken, stripBumpTokens } from "./lib/bump-token.mjs";
import { buildFallbackSummary, stripConventionalPrefix } from "./lib/fallback-summary.mjs";

const ROOT = repoRoot();
const BASE = process.env.BASE_BRANCH ?? "master";
const PR_NUMBER = process.env.PR_NUMBER;
const PR_TITLE = process.env.PR_TITLE ?? "";
const PR_BODY = process.env.PR_BODY ?? "";
const HEAD_REF = process.env.HEAD_REF;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

if (!PR_NUMBER || !HEAD_REF) {
  console.error("PR_NUMBER and HEAD_REF are required");
  process.exit(1);
}

/** Skip when the latest commit only updated changeset files (bot loop guard). */
function isOnlyChangesetCommit() {
  try {
    const files = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    return files.length > 0 && files.every((f) => f.startsWith(".changeset/"));
  } catch {
    return false;
  }
}

if (isOnlyChangesetCommit()) {
  console.log("Latest commit only touches .changeset/ — skipping (bot loop guard).");
  process.exit(0);
}

execSync(`git fetch origin ${BASE}`, { stdio: "inherit" });

const changedFiles = execSync(`git diff --name-only origin/${BASE}...HEAD`, {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const affected = packagesFromChangedFiles(changedFiles);
const { skip, bump } = parseBumpToken(PR_TITLE, PR_BODY);
const changesetPath = join(ROOT, ".changeset", `pr-${PR_NUMBER}.md`);

if (affected.length === 0) {
  console.log("No publishable packages changed — skipping.");
  process.exit(0);
}

if (skip) {
  if (existsSync(changesetPath)) unlinkSync(changesetPath);
  console.log("@skip-changeset — removed changeset if present.");
  process.exit(0);
}

if (!bump) {
  console.error(
    "Publishable packages changed but no @patch/@minor/@major token found.",
  );
  process.exit(1);
}

const diff = execSync(`git diff origin/${BASE}...HEAD`, {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
}).slice(0, 60_000);

const commits = execSync(`git log origin/${BASE}..HEAD --format=%s`, {
  encoding: "utf8",
}).trim();

/** Commit subjects that touched files under packages/ (exclude bot changeset commits). */
function packageCommitSubjects() {
  const hashes = execSync(`git log origin/${BASE}..HEAD --format=%H`, {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  return hashes
    .map((hash) => {
      const files = execSync(`git diff-tree --no-commit-id --name-only -r ${hash}`, {
        encoding: "utf8",
      })
        .split("\n")
        .filter(Boolean);
      if (!files.some((f) => f.startsWith("packages/"))) return null;
      const subject = execSync(`git log -1 --format=%s ${hash}`, {
        encoding: "utf8",
      }).trim();
      if (/^chore\(changeset\):/i.test(subject)) return null;
      return stripConventionalPrefix(subject);
    })
    .filter(Boolean);
}

const cleanTitle = stripBumpTokens(PR_TITLE);
const cleanBody = stripBumpTokens(PR_BODY);

const fallbackSummary = buildFallbackSummary({
  commitSubjects: packageCommitSubjects(),
  changedFiles,
  cleanTitle,
  cleanBody,
  affected,
});

let summary = fallbackSummary;
let suggestedBump = bump;

const apiKey = process.env.ANTHROPIC_API_KEY;
if (apiKey) {
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `You write CHANGELOG entries for an SDK. Given the PR title, body, commits, and diff, write ONE concise consumer-facing sentence. Focus on what changed for users, not implementation. Use backticks for API names. No "this PR" preamble.

Respond as strict JSON only: {"summary": string, "suggestedBump": "patch"|"minor"|"major"}

Title: ${cleanTitle}
Body: ${cleanBody}
Commits:
${commits}

Diff:
${diff}`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    if (parsed.summary) summary = parsed.summary;
    if (parsed.suggestedBump) suggestedBump = parsed.suggestedBump;
    console.log("LLM summary generated.");
  } catch (err) {
    console.warn("LLM unavailable, using commit-based fallback:", err.message);
    summary = fallbackSummary;
  }
} else {
  console.warn("ANTHROPIC_API_KEY not set — using commit-based fallback.");
}

const frontmatter = affected.map((name) => `"${name}": ${bump}`).join("\n");
const content = `---\n${frontmatter}\n---\n\n${summary}\n`;

mkdirSync(join(ROOT, ".changeset"), { recursive: true });

const previous = existsSync(changesetPath)
  ? readFileSync(changesetPath, "utf8")
  : null;

writeFileSync(changesetPath, content, "utf8");
console.log(`Wrote ${changesetPath}`);
console.log(`Summary: ${summary}`);
console.log(`Bump (from PR token): ${bump}; LLM suggested: ${suggestedBump}`);
if (previous === content) {
  console.log("Changeset content unchanged from previous version.");
} else if (previous) {
  console.log("Changeset content updated.");
}
