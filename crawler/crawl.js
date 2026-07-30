/**
 * Playwright crawler — visits sites, takes viewport screenshots.
 *
 * Each site gets its own BrowserContext (isolated cookies/cache) to prevent
 * cross-site contamination. Contexts are closed immediately after use so
 * memory stays bounded.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const db = require("./db");

const CONCURRENCY = parseInt(process.env.CRAWL_CONCURRENCY || process.env.CONCURRENCY || "5");
const TIMEOUT = parseInt(process.env.CRAWL_TIMEOUT || process.env.TIMEOUT || "15000");
const SCREENSHOT_DIR = path.join(__dirname, "../data/screenshots");

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── Simple semaphore ──────────────────────────────────────────────────────────

class Semaphore {
  constructor(n) {
    this._n = n;
    this._waiting = [];
  }
  acquire() {
    if (this._n > 0) {
      this._n--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this._waiting.push(resolve));
  }
  release() {
    if (this._waiting.length > 0) {
      this._waiting.shift()();
    } else {
      this._n++;
    }
  }
}

// Errors that will never succeed on retry — don't waste time
const PERMANENT_ERRORS = [
  "ERR_NAME_NOT_RESOLVED",
  "ERR_ADDRESS_UNREACHABLE",
];

function isPermanent(msg) {
  return PERMANENT_ERRORS.some((e) => msg.includes(e));
}

// Detect Lovable's "project not found" error page — no point screenshotting or analyzing
const NOT_FOUND_TITLES = ["lovable", "project not found", "page not found", "404"];
const NOT_FOUND_BODIES = ["project not found", "doesn't exist", "this project"];

function isLovable404(title, url) {
  const t = (title || "").toLowerCase().trim();
  // Empty title or generic Lovable title with no project name
  if (t === "" || NOT_FOUND_TITLES.includes(t)) return true;
  return false;
}

// ── Per-site crawl ────────────────────────────────────────────────────────────

async function crawlOne(browser, site, sem) {
  await sem.acquire();
  const { id, url } = site;
  const screenshotPath = path.join(SCREENSHOT_DIR, `${id}.png`);

  await db.markCrawling(id);

  let lastErr;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let context;
    try {
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/124.0 Safari/537.36",
        ignoreHTTPSErrors: true,
      });

      const page = await context.newPage();

      await page.route("**/*.{mp4,webm,ogg,woff,woff2,ttf,otf}", (route) =>
        route.abort()
      );

      await page.goto(url, {
        timeout: TIMEOUT,
        waitUntil: "domcontentloaded",
      });

      await page.waitForTimeout(2500);

      const title = await page.title();

      if (isLovable404(title, url)) {
        await db.markNotFound(id);
        process.stdout.write(`  ⊘  ${url}  [project not found]\n`);
        await context.close();
        sem.release();
        return;
      }

      // DOM size feeds the deterministic local_score heuristics
      let domNodes = null;
      try {
        domNodes = await page.evaluate(() => document.querySelectorAll("*").length);
      } catch (_) {}

      await page.screenshot({
        path: screenshotPath,
        clip: { x: 0, y: 0, width: 1280, height: 800 },
      });

      await db.markDone(id, screenshotPath, title, domNodes);
      process.stdout.write(`  ✓  ${url}  ${title ? `[${title.slice(0, 40)}]` : ""}\n`);
      await context.close();
      sem.release();
      return;
    } catch (err) {
      lastErr = err;
      try { await context?.close(); } catch (_) {}

      if (isPermanent(err.message)) break; // no point retrying
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }

  const reason = lastErr.message.split("\n")[0].slice(0, 60);
  await db.markFailed(id, lastErr.message);
  process.stdout.write(`  ✗  ${url}  [${reason}]\n`);
  sem.release();
}

// ── Batch runner ──────────────────────────────────────────────────────────────

async function runBatch(browser, sites) {
  const sem = new Semaphore(CONCURRENCY);
  await Promise.all(sites.map((site) => crawlOne(browser, site, sem)));
}

// ── Main export ───────────────────────────────────────────────────────────────

async function crawlAll() {
  const stalled = await db.resetStalled();
  if (stalled > 0) console.log(`Reset ${stalled} stalled rows to pending.`);

  const pending = await db.countPending();
  if (pending === 0) {
    console.log("Nothing pending to crawl.");
    for (const { url, error } of await db.getFailed()) {
      const reason = (error || "unknown").split("\n")[0].slice(0, 80);
      console.log(`  ✗  ${url}  [${reason}]`);
    }
    return;
  }
  console.log(`Starting crawl — ${pending} pending  concurrency=${CONCURRENCY}`);

  const browser = await chromium.launch({ headless: true });
  let processed = 0;

  try {
    while (true) {
      const batch = await db.getPending(CONCURRENCY * 4);
      if (batch.length === 0) break;

      await runBatch(browser, batch);
      processed += batch.length;

      const stats = await db.getStats();
      const summary = stats.map((s) => `${s.status}=${s.count}`).join("  ");
      console.log(`[${new Date().toISOString().slice(11, 19)}] ${summary}`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nCrawl complete — ${processed} processed.`);
}

module.exports = { crawlAll };
