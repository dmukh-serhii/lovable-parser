/**
 * Smoke-test the crawler against 1 known-good lovable.app URL.
 * Always resets the URL to pending so re-runs work cleanly.
 *
 *   node test/test_crawl.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const db = require("../crawler/db");
const { crawlAll } = require("../crawler/crawl");

// A real lovable.app site that's reliably up
const TEST_URL = "https://iridescent-crepe-a8c234.lovable.app";

async function main() {
  console.log(`\n[test:crawl] target: ${TEST_URL}`);

  // Always reset so re-runs don't get stuck on a previous failed/done row
  await db.resetUrl(TEST_URL);

  const stats = await db.getStats();
  console.log("[test:crawl] DB:", stats.map((s) => `${s.status}=${s.count}`).join("  "));

  await crawlAll();

  const final = await db.getStats();
  const done = final.find((s) => s.status === "done")?.count ?? 0;
  const failed = final.find((s) => s.status === "failed")?.count ?? 0;
  await db.close();

  if (done > 0) {
    console.log("\n[test:crawl] PASS — screenshot saved to data/screenshots/");
  } else {
    console.error(`\n[test:crawl] FAIL — done=${done} failed=${failed}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[test:crawl]", err.message);
  process.exit(1);
});
