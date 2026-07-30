require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const db = require("./db");
const { crawlAll } = require("./crawl");

const DOMAINS_FILE = path.join(__dirname, "../data/domains.txt");

async function loadDomains() {
  const DATA_DIR = path.join(__dirname, "../data");
  const sources = [
    { file: path.join(DATA_DIR, "domains_cc.txt"), source: "cc" },
    { file: path.join(DATA_DIR, "domains_wb.txt"), source: "wb" },
  ];

  // Fall back to legacy combined file
  const hasSourceFiles = sources.some((s) => fs.existsSync(s.file));
  if (!hasSourceFiles) {
    if (!fs.existsSync(DOMAINS_FILE)) {
      console.log("data/domains.txt not found — skipping domain load.");
      console.log("Run:  python scripts/fetch_domains.py  first.");
      return 0;
    }
    const urls = fs.readFileSync(DOMAINS_FILE, "utf-8").split("\n")
      .map((u) => u.trim()).filter((u) => u.startsWith("http"));
    await db.insertUrls(urls, "unknown");
    console.log(`Loaded ${urls.length} URLs from domains.txt (source=unknown)`);
    return urls.length;
  }

  const crawlLimit = parseInt(process.env.CRAWL_LIMIT || "0");

  let total = 0;
  for (const { file, source } of sources) {
    if (!fs.existsSync(file)) continue;
    let urls = fs.readFileSync(file, "utf-8").split("\n")
      .map((u) => u.trim()).filter((u) => u.startsWith("http"));
    if (urls.length === 0) continue;
    if (crawlLimit > 0) urls = urls.slice(0, crawlLimit);
    await db.insertUrls(urls, source);
    console.log(`Loaded ${urls.length} URLs from domains_${source}.txt`);
    total += urls.length;
  }
  return total;
}

async function main() {
  const retry = process.argv.includes("--retry");
  // --no-load: crawl only rows already pending in the DB (used by the admin
  // panel's refetch so it doesn't enqueue new domains from domains_*.txt)
  const noLoad = process.argv.includes("--no-load");
  // --load-only: import domains_*.txt into the DB and exit without crawling
  // (used by the admin panel's "Refresh data" stage)
  const loadOnly = process.argv.includes("--load-only");

  if (!noLoad) await loadDomains();

  if (loadOnly) {
    const stats = await db.getStats();
    console.log(
      "DB after load: " + stats.map((s) => `${s.status}=${s.count}`).join("  ")
    );
    await db.close();
    return;
  }

  if (retry) {
    const n = await db.resetTransientFailed();
    if (n > 0) console.log(`Retrying ${n} transient failures.`);
  }

  const stats = await db.getStats();
  if (stats.length > 0) {
    console.log("DB: " + stats.map((s) => `${s.status}=${s.count}`).join("  "));
  }

  await crawlAll();
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
