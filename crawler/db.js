/**
 * Postgres (Neon) data layer for the crawler.
 * Same function surface as the old SQLite version, but async.
 *
 * Connection comes from CRAWLER_DATABASE_URL (falls back to DATABASE_URL).
 * Schema is owned by scripts/migrate_to_neon.py — this module only queries.
 */
const { Pool } = require("pg");

let _pool = null;

function pool() {
  if (_pool) return _pool;
  const url = process.env.CRAWLER_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "No database URL configured.\n" +
        "Set DATABASE_URL (and optionally CRAWLER_DATABASE_URL) in .env — " +
        "run scripts/migrate_to_neon.py first to create the schema."
    );
    process.exit(1);
  }
  const local = /localhost|127\.0\.0\.1/.test(url);
  _pool = new Pool({
    connectionString: url,
    ssl: local ? undefined : { rejectUnauthorized: false },
    max: parseInt(process.env.DB_POOL_SIZE || "10"),
  });
  return _pool;
}

async function query(text, params) {
  return pool().query(text, params);
}

// ── Write ops ─────────────────────────────────────────────────────────────────

async function insertUrls(urls, source = "unknown") {
  // batched multi-row insert — one round trip per 1000 urls
  const BATCH = 1000;
  for (let i = 0; i < urls.length; i += BATCH) {
    const chunk = urls.slice(i, i + BATCH);
    const values = [];
    const params = [];
    chunk.forEach((url, j) => {
      values.push(`($${j * 2 + 1}, $${j * 2 + 2})`);
      params.push(url, source);
    });
    await query(
      `INSERT INTO sites (url, source) VALUES ${values.join(",")} ON CONFLICT (url) DO NOTHING`,
      params
    );
  }
}

async function markCrawling(id) {
  await query("UPDATE sites SET status='crawling' WHERE id=$1", [id]);
}

async function markDone(id, screenshotPath, title, domNodes) {
  await query(
    `UPDATE sites SET status='done', screenshot_path=$1, title=$2, dom_nodes=$3,
       crawled_at=EXTRACT(EPOCH FROM now())::BIGINT,
       analyzed_at=NULL, local_score=NULL
     WHERE id=$4`,
    [screenshotPath, title || null, domNodes ?? null, id]
  );
}

async function markNotFound(id) {
  await query(
    "UPDATE sites SET status='not_found', crawled_at=EXTRACT(EPOCH FROM now())::BIGINT WHERE id=$1",
    [id]
  );
}

async function markFailed(id, error) {
  await query(
    "UPDATE sites SET status='failed', error=$1, crawled_at=EXTRACT(EPOCH FROM now())::BIGINT WHERE id=$2",
    [String(error).slice(0, 500), id]
  );
}

// Reset stalled 'crawling' rows from a previous interrupted run
async function resetStalled() {
  const r = await query("UPDATE sites SET status='pending' WHERE status='crawling'");
  return r.rowCount;
}

// Retry transient failures — skip permanent ones like DNS not resolved
async function resetTransientFailed() {
  const r = await query(
    `UPDATE sites SET status='pending', error=NULL
     WHERE status='failed'
       AND error NOT LIKE '%ERR_NAME_NOT_RESOLVED%'
       AND error NOT LIKE '%ERR_CERT_%'
       AND error NOT LIKE '%net::ERR_ABORTED%'`
  );
  return r.rowCount;
}

// Force a specific URL back to pending (used by test scripts)
async function resetUrl(url) {
  await query(
    `INSERT INTO sites (url) VALUES ($1)
     ON CONFLICT (url) DO UPDATE
       SET status='pending', error=NULL, screenshot_path=NULL, analyzed_at=NULL`,
    [url]
  );
}

// ── Read ops ──────────────────────────────────────────────────────────────────

async function getPending(limit) {
  const r = await query(
    "SELECT id, url FROM sites WHERE status='pending' ORDER BY id LIMIT $1",
    [limit]
  );
  return r.rows;
}

async function getStats() {
  const r = await query(
    "SELECT status, COUNT(*)::INT AS count FROM sites GROUP BY status ORDER BY status"
  );
  return r.rows;
}

async function getStatsBySource() {
  const r = await query(
    "SELECT source, status, COUNT(*)::INT AS count FROM sites GROUP BY source, status ORDER BY source, status"
  );
  return r.rows;
}

async function getScoreDistribution() {
  const r = await query(
    `SELECT ROUND(ai_score)::INT AS score, COUNT(*)::INT AS count
     FROM sites WHERE ai_score IS NOT NULL
     GROUP BY score ORDER BY score DESC`
  );
  return r.rows;
}

async function countPending() {
  const r = await query("SELECT COUNT(*)::INT AS n FROM sites WHERE status='pending'");
  return r.rows[0].n;
}

async function getFailed() {
  const r = await query(
    "SELECT url, error FROM sites WHERE status='failed' ORDER BY url"
  );
  return r.rows;
}

async function close() {
  if (_pool) await _pool.end();
  _pool = null;
}

module.exports = {
  insertUrls,
  getStatsBySource,
  getScoreDistribution,
  markCrawling,
  markDone,
  markNotFound,
  markFailed,
  resetStalled,
  resetTransientFailed,
  resetUrl,
  getPending,
  getStats,
  countPending,
  getFailed,
  close,
};
