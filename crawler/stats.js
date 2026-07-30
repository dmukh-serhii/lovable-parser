/**
 * Quick status dump — run at any time while the crawler is running.
 *   node crawler/stats.js
 *   node crawler/stats.js --failed   # also list failed URLs
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const db = require("./db");

const showFailed = process.argv.includes("--failed");

async function main() {
  // ── Status counts ───────────────────────────────────────────────────────────

  const stats = await db.getStats();
  const total = stats.reduce((s, r) => s + r.count, 0);

  console.log(`\n=== lovable-parser status ===`);
  for (const { status, count } of stats) {
    const bar = "█".repeat(Math.round((count / total) * 30)).padEnd(30);
    console.log(`  ${status.padEnd(12)} ${String(count).padStart(6)}  ${bar}`);
  }
  console.log(`  ${"total".padEnd(12)} ${String(total).padStart(6)}`);

  // ── Per-source breakdown ────────────────────────────────────────────────────

  const bySource = await db.getStatsBySource();
  if (bySource.length > 0) {
    const sources = [...new Set(bySource.map((r) => r.source))];
    console.log(`\n── by source ──`);
    for (const source of sources) {
      const rows = bySource.filter((r) => r.source === source);
      const srcTotal = rows.reduce((s, r) => s + r.count, 0);
      const summary = rows.map((r) => `${r.status}=${r.count}`).join("  ");
      console.log(`  ${source.padEnd(8)} ${String(srcTotal).padStart(6)}  ${summary}`);
    }
  }

  // ── AI score distribution ───────────────────────────────────────────────────

  const scores = await db.getScoreDistribution();
  if (scores.length > 0) {
    const scoreTotal = scores.reduce((s, r) => s + r.count, 0);
    console.log(`\n── ai scores (${scoreTotal} analyzed) ──`);
    for (const { score, count } of scores) {
      const bar = "█".repeat(Math.round((count / scoreTotal) * 20)).padEnd(20);
      console.log(`  ${String(score).padStart(2)}  ${String(count).padStart(5)}  ${bar}`);
    }
  }

  // ── Failed URLs ─────────────────────────────────────────────────────────────

  const failed = await db.getFailed();

  if (failed.length === 0) {
    console.log("\nNo failures.\n");
  } else if (showFailed) {
    console.log(`\n── Failed (${failed.length}) ──`);
    for (const { url, error } of failed) {
      const reason = (error || "unknown").split("\n")[0].slice(0, 80);
      console.log(`  ${url}`);
      console.log(`    ${reason}`);
    }
    console.log();
  } else {
    console.log(`\n  ${failed.length} failed — run with --failed to list URLs\n`);
  }

  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
