import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { packagesFromChangedFiles, repoRoot } from "./lib/packages.mjs";
import { buildFallbackSummary } from "./lib/fallback-summary.mjs";

const ROOT = repoRoot();
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const BASE = process.env.BASE_BRANCH ?? "master";
const bump = (process.argv[2] ?? "").toLowerCase();

if (!["patch", "minor", "major"].includes(bump)) {
  console.error("Usage: pnpm changeset-ai:generate <patch|minor|major>");
  process.exit(1);
}

function execOut(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim();
}

function changedFilesFromBase(base) {
  try {
    execSync(`git fetch origin ${base}`, { stdio: "ignore" });
  } catch {
    // allow local-only fallback below
  }

  let files = [];
  try {
    files = execOut(`git diff --name-only origin/${base}...HEAD`)
      .split("\n")
      .filter(Boolean);
  } catch {
    files = execOut("git diff --name-only HEAD")
      .split("\n")
      .filter(Boolean);
  }

  // Include unstaged + staged local edits too.
  const working = execOut("git diff --name-only")
    .split("\n")
    .filter(Boolean);
  const staged = execOut("git diff --name-only --cached")
    .split("\n")
    .filter(Boolean);

  return [...new Set([...files, ...working, ...staged])];
}

function changesetFileName() {
  const hash = createHash("sha1")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 12);
  return `${hash}.md`;
}

const changedFiles = changedFilesFromBase(BASE);
const affected = packagesFromChangedFiles(changedFiles);

if (affected.length === 0) {
  console.error("No publishable package changes detected. No changeset generated.");
  process.exit(1);
}

const diff = execOut(`git diff origin/${BASE}...HEAD`).slice(0, 60_000);
const commits = execOut(`git log origin/${BASE}..HEAD --format=%s`);

let summary = buildFallbackSummary({
  commitSubjects: commits.split("\n").filter(Boolean),
  changedFiles,
  cleanTitle: "",
  cleanBody: "",
  affected,
});

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
          content: `You write CHANGELOG entries for an SDK. Given commits and diff, write ONE concise consumer-facing sentence. Focus on user impact, not implementation. Use backticks for API names.

Respond as strict JSON only: {"summary": string}

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
  } catch (err) {
    console.warn("LLM unavailable, using fallback summary:", err.message);
  }
} else {
  console.warn("ANTHROPIC_API_KEY not set — using fallback summary.");
}

const frontmatter = affected.map((name) => `"${name}": ${bump}`).join("\n");
const content = `---\n${frontmatter}\n---\n\n${summary}\n`;

const dir = join(ROOT, ".changeset");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const out = join(dir, changesetFileName());
writeFileSync(out, content, "utf8");

console.log(`Generated changeset: ${out}`);
console.log(`Packages: ${affected.join(", ")}`);
console.log(`Bump: ${bump}`);
