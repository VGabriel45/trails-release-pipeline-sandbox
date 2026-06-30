import { filterChangesetsByPackage } from "./lib/filter-changesets.mjs";

try {
  filterChangesetsByPackage(process.env.RELEASE_PACKAGES ?? "all");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
