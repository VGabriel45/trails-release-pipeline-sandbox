import { execSync } from "node:child_process";

execSync("pnpm exec changeset publish", { stdio: "inherit" });
execSync("git push --follow-tags origin production", { stdio: "inherit" });

const tags = execSync("git tag --sort=-creatordate", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .slice(0, 5);

for (const tag of tags) {
  try {
    execSync(`gh release view "${tag}"`, { stdio: "pipe" });
  } catch {
    execSync(`gh release create "${tag}" --generate-notes`, { stdio: "inherit" });
  }
}

console.log("Publish complete.");
