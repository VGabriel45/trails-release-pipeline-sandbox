import { execSync } from "node:child_process";

execSync("git fetch origin master", { stdio: "inherit" });
execSync("git checkout master", { stdio: "inherit" });
execSync("git pull origin master", { stdio: "inherit" });

const pending = execSync('ls .changeset/*.md 2>/dev/null || true', {
  encoding: "utf8",
  shell: "/bin/bash",
}).trim();

if (!pending) {
  console.error("No pending changesets on master — nothing to release.");
  process.exit(1);
}

execSync("pnpm exec changeset version", {
  stdio: "inherit",
  env: { ...process.env, GITHUB_TOKEN: process.env.GITHUB_TOKEN },
});

const version = JSON.parse(
  execSync("node -e \"console.log(require('./packages/demo-sdk/package.json').version)\"", {
    encoding: "utf8",
  }).trim(),
);

execSync("git add -A", { stdio: "inherit" });
execSync(`git commit -m "chore(release): v${version}"`, { stdio: "inherit" });
execSync("git push origin master", { stdio: "inherit" });

const prUrl = execSync(
  `gh pr create --base production --head master --title "Release v${version}" --body "Automated release PR from release-prepare workflow."`,
  { encoding: "utf8" },
).trim();

console.log(`Release PR: ${prUrl}`);
