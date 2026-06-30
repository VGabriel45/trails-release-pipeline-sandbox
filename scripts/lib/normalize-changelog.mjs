import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SECTION_MAP = {
  "### Major Changes": "### major",
  "### Minor Changes": "### minor",
  "### Patch Changes": "### patch",
};

/** Strip legacy changelog-github formatting if present. */
function stripGithubArtifacts(line) {
  return line
    .replace(
      /^- \[#\d+\]\([^)]+\) \[`[a-f0-9]+`\]\([^)]+\) Thanks \[[^\]]+\]\([^)]+\)! - /,
      "- ",
    )
    .replace(/^- Thanks \[[^\]]+\]\([^)]+\)! - /, "- ");
}

export function normalizeChangelogContent(content, packageName) {
  let lines = content.split("\n").map(stripGithubArtifacts);

  lines = lines.map((line) => SECTION_MAP[line.trim()] ?? line);

  let body = lines.join("\n").trimEnd();

  if (!body.startsWith(`# ${packageName}`)) {
    body = `# ${packageName}\n\n${body.replace(/^# [^\n]+\n+/, "")}`;
  }

  return `${body}\n`;
}

export function normalizePackageChangelogs(packagesDir = "packages") {
  for (const entry of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, entry);
    if (!statSync(pkgDir).isDirectory()) continue;

    const changelogPath = join(pkgDir, "CHANGELOG.md");
    const pkgPath = join(pkgDir, "package.json");

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const raw = readFileSync(changelogPath, "utf8");
      writeFileSync(
        changelogPath,
        normalizeChangelogContent(raw, pkg.name),
        "utf8",
      );
      console.log(`Normalized ${changelogPath}`);
    } catch {
      // no CHANGELOG for this package
    }
  }
}
