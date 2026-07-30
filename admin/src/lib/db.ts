/**
 * Read layer over the pipeline's Neon Postgres database.
 *
 * Uses @neondatabase/serverless (HTTP driver) so the same code runs in
 * local Node and on Cloudflare Workers. Reads go through ADMIN_DATABASE_URL
 * (read-only role); the refetch reset is the only write and requires
 * CRAWLER_DATABASE_URL — absent on the deployed read-only instance.
 */
import { neon } from "@neondatabase/serverless";
import path from "path";
import type {
  Site,
  SiteFilters,
  SitesResponse,
  StatsResponse,
} from "./types";

/** Project root = parent of admin/ unless overridden (local dev only). */
export const PROJECT_ROOT =
  process.env.LOVABLE_PARSER_ROOT || path.join(process.cwd(), "..");

type NeonSql = ReturnType<typeof neon>;

let _ro: NeonSql | null = null;
let _rw: NeonSql | null = null;

function readSql(): NeonSql {
  if (!_ro) {
    const url =
      process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || "";
    if (!url) {
      throw new Error(
        "No database URL: set ADMIN_DATABASE_URL (read-only role) or DATABASE_URL in admin/.env.local"
      );
    }
    _ro = neon(url);
  }
  return _ro;
}

/** Write connection for refetch reset — intentionally absent when deployed read-only. */
function writeSql(): NeonSql {
  if (!_rw) {
    const url = process.env.CRAWLER_DATABASE_URL || "";
    if (!url) {
      throw new Error(
        "Refetch is disabled on this deployment: no CRAWLER_DATABASE_URL (read-only instance)."
      );
    }
    _rw = neon(url);
  }
  return _rw;
}

export function hasWriteAccess(): boolean {
  return Boolean(process.env.CRAWLER_DATABASE_URL);
}

/**
 * SQL expression classifying `error` into a failure type.
 * Keep in sync with crawler/crawl.js PERMANENT_ERRORS and
 * scripts/export_crawled.py FAILURE_CASE.
 */
export const FAILURE_CASE = `
  CASE
    WHEN error IS NULL THEN NULL
    WHEN error LIKE '%ERR_NAME_NOT_RESOLVED%' THEN 'dns'
    WHEN error LIKE '%ERR_ADDRESS_UNREACHABLE%' THEN 'unreachable'
    WHEN error LIKE '%ERR_CERT_%' THEN 'cert'
    WHEN error LIKE '%net::ERR_ABORTED%' THEN 'aborted'
    WHEN error LIKE '%imeout%' THEN 'timeout'
    WHEN error LIKE '%ERR_CONNECTION%' THEN 'connection'
    ELSE 'other'
  END`;

const SORTABLE = new Set([
  "id",
  "url",
  "source",
  "status",
  "ai_score",
  "local_score",
  "dom_nodes",
  "category",
  "title",
  "created_at",
  "crawled_at",
  "analyzed_at",
]);

function buildWhere(f: SiteFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const p = () => `$${params.length}`;

  if (f.q) {
    params.push(`%${f.q}%`);
    clauses.push(`(url ILIKE ${p()} OR title ILIKE ${p()})`);
  }
  if (f.scoreMin !== undefined) {
    params.push(f.scoreMin);
    clauses.push(`ai_score >= ${p()}`);
  }
  if (f.scoreMax !== undefined) {
    params.push(f.scoreMax);
    clauses.push(`ai_score <= ${p()}`);
  }
  if (f.source?.length) {
    params.push(f.source);
    clauses.push(`source = ANY(${p()})`);
  }
  if (f.status?.length) {
    params.push(f.status);
    clauses.push(`status = ANY(${p()})`);
  }
  if (f.failure?.length) {
    params.push(f.failure);
    clauses.push(`(${FAILURE_CASE}) = ANY(${p()})`);
  }
  if (f.category?.length) {
    params.push(f.category);
    clauses.push(`category = ANY(${p()})`);
  }
  if (f.crawledFrom !== undefined) {
    params.push(f.crawledFrom);
    clauses.push(`crawled_at >= ${p()}`);
  }
  if (f.crawledTo !== undefined) {
    params.push(f.crawledTo);
    clauses.push(`crawled_at <= ${p()}`);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

// Columns returned to the client.
const SITE_COLUMNS =
  "id, url, source, status, screenshot_path, screenshot_key, error, " +
  "created_at, crawled_at, analyzed_at, ai_score, local_score, dom_nodes, " +
  "category, ai_feedback, title, notified_at";

export async function querySites(f: SiteFilters): Promise<SitesResponse> {
  const sql = readSql();
  const { where, params } = buildWhere(f);

  const sort = SORTABLE.has(f.sort ?? "") ? f.sort : "id";
  const dir = f.dir === "asc" ? "ASC" : "DESC";
  // NULLS LAST so unanalyzed rows don't dominate score sorts
  const orderBy = `ORDER BY ${sort} IS NULL, ${sort} ${dir}, id ASC`;

  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 10), 200);
  const page = Math.max(f.page ?? 1, 1);

  const countRows = (await sql.query(
    `SELECT COUNT(*)::INT AS n FROM sites ${where}`,
    params
  )) as { n: number }[];

  const rows = (await sql.query(
    `SELECT ${SITE_COLUMNS}, (${FAILURE_CASE}) AS failure_type
     FROM sites ${where} ${orderBy}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  )) as Site[];

  return { rows, total: countRows[0].n, page, pageSize };
}

export async function getSite(id: number): Promise<Site | undefined> {
  const rows = (await readSql().query(
    `SELECT ${SITE_COLUMNS}, (${FAILURE_CASE}) AS failure_type FROM sites WHERE id = $1`,
    [id]
  )) as Site[];
  return rows[0];
}

/** Columns in the CSV report (order matters). */
export const EXPORT_COLUMNS = [
  "url", "title", "source", "status", "ai_score", "local_score", "dom_nodes",
  "category", "created_at",
] as const;

const EXPORT_SOURCE_LABEL: Record<string, string> = {
  cc: "CommonCrawl",
  wb: "Wayback Machine",
  unknown: "Other",
};

/** epoch seconds → YYYY-MM-DD (no time). */
function epochToDate(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n * 1000).toISOString().slice(0, 10);
}

/**
 * All rows matching the filters, for the CSV report. Runs entirely in
 * Postgres (no Python subprocess) so it works on Cloudflare Workers too.
 * Capped to keep a single Worker response bounded.
 */
export async function queryForExport(f: SiteFilters): Promise<Record<string, unknown>[]> {
  const { where, params } = buildWhere(f);
  const sort = SORTABLE.has(f.sort ?? "") ? f.sort : "ai_score";
  const dir = f.dir === "asc" ? "ASC" : "DESC";
  const cols = EXPORT_COLUMNS.join(", ");
  const rows = (await readSql().query(
    `SELECT ${cols}
     FROM sites ${where}
     ORDER BY ${sort} IS NULL, ${sort} ${dir}, id ASC
     LIMIT 100000`,
    params
  )) as Record<string, unknown>[];

  // Humanize: full source names + a plain date for created_at.
  for (const r of rows) {
    r.source = EXPORT_SOURCE_LABEL[String(r.source)] ?? r.source;
    r.created_at = epochToDate(r.created_at);
  }
  return rows;
}

/** RFC 4180 CSV: quote fields containing comma/quote/newline, double interior quotes. */
export function toCsv(
  rows: Record<string, unknown>[],
  columns: readonly string[]
): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => esc(row[c])).join(","));
  }
  return lines.join("\r\n");
}

/** Resolve a filter set to matching site ids (for filtered refetch). */
export async function queryIds(f: SiteFilters): Promise<number[]> {
  const { where, params } = buildWhere(f);
  const rows = (await readSql().query(
    `SELECT id FROM sites ${where}`,
    params
  )) as { id: number }[];
  return rows.map((r) => Number(r.id));
}

export async function getStats(): Promise<StatsResponse> {
  const sql = readSql();
  const [byStatus, bySource, scoreDistribution, agg, categories, last] =
    (await Promise.all([
      sql.query(
        "SELECT status, COUNT(*)::INT AS count FROM sites GROUP BY status"
      ),
      sql.query(
        "SELECT source, status, COUNT(*)::INT AS count FROM sites GROUP BY source, status ORDER BY source, status"
      ),
      sql.query(
        "SELECT ROUND(ai_score)::INT AS score, COUNT(*)::INT AS count " +
          "FROM sites WHERE ai_score IS NOT NULL GROUP BY score ORDER BY score"
      ),
      sql.query(
        "SELECT COUNT(*)::INT AS analyzed, AVG(ai_score)::FLOAT AS avg FROM sites WHERE ai_score IS NOT NULL"
      ),
      sql.query(
        "SELECT category, COUNT(*)::INT AS count, ROUND(AVG(ai_score)::NUMERIC, 1)::FLOAT AS \"avgScore\" " +
          "FROM sites WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC"
      ),
      sql.query("SELECT MAX(crawled_at)::BIGINT AS t FROM sites"),
    ])) as [
      StatsResponse["byStatus"],
      StatsResponse["bySource"],
      StatsResponse["scoreDistribution"],
      { analyzed: number; avg: number | null }[],
      StatsResponse["categories"],
      { t: number | null }[],
    ];

  const total = byStatus.reduce((s, r) => s + r.count, 0);
  const failedCount = byStatus.find((r) => r.status === "failed")?.count ?? 0;

  return {
    total,
    byStatus,
    bySource,
    scoreDistribution,
    avgScore: agg[0]?.avg ?? null,
    analyzedCount: agg[0]?.analyzed ?? 0,
    failedCount,
    categories,
    lastCrawledAt: last[0]?.t != null ? Number(last[0].t) : null,
  };
}

/**
 * Live aggregates for the public /methodology page. Everything is computed
 * server-side in SQL; the scatter is density-bucketed above 2k scored rows
 * so the payload stays small regardless of dataset size.
 */
export async function getMethodology(): Promise<
  import("./types").MethodologyData
> {
  const sql = readSql();

  const [bySourceStatus, byStatus, failures, scoredAgg] = (await Promise.all([
    sql.query(
      "SELECT source, status, COUNT(*)::INT AS count FROM sites GROUP BY source, status"
    ),
    sql.query("SELECT status, COUNT(*)::INT AS count FROM sites GROUP BY status"),
    sql.query(
      `SELECT (${FAILURE_CASE}) AS type, COUNT(*)::INT AS count
       FROM sites WHERE status='failed' GROUP BY 1 ORDER BY count DESC`
    ),
    sql.query(
      `SELECT COUNT(*)::INT AS scored, corr(ai_score, local_score)::FLOAT AS correlation
       FROM sites WHERE ai_score IS NOT NULL AND local_score IS NOT NULL`
    ),
  ])) as [
    { source: string; status: string; count: number }[],
    { status: string; count: number }[],
    { type: string; count: number }[],
    { scored: number; correlation: number | null }[],
  ];

  const SHOT = new Set(["done", "analyzed"]);
  const sources = [...new Set(bySourceStatus.map((r) => r.source))].sort();
  const bySource = sources.map((source) => {
    const rows = bySourceStatus.filter((r) => r.source === source);
    const sum = (pred: (s: string) => boolean) =>
      rows.filter((r) => pred(r.status)).reduce((a, r) => a + r.count, 0);
    return {
      source,
      discovered: rows.reduce((a, r) => a + r.count, 0),
      screenshotted: sum((s) => SHOT.has(s)),
      failed: sum((s) => s === "failed"),
      notFound: sum((s) => s === "not_found"),
    };
  });

  const stat = (s: string) =>
    byStatus.find((r) => r.status === s)?.count ?? 0;
  const screenshotted = stat("done") + stat("analyzed");
  const failed = stat("failed");
  const notFound = stat("not_found");
  const totals = {
    discovered: byStatus.reduce((a, r) => a + r.count, 0),
    screenshotted,
    analyzed: stat("analyzed"),
    failed,
    notFound,
    pending: stat("pending") + stat("crawling"),
    crawlAttempted: screenshotted + failed + notFound,
  };

  const scored = scoredAgg[0]?.scored ?? 0;
  const correlation = scoredAgg[0]?.correlation ?? null;

  // Heatmap cells — local bucketed to 0.5 steps (half-points preserved),
  // ai kept at integer resolution. Same filtered row set as `correlation`
  // above, so the printed r is a single source of truth for the chart.
  const cells = (await sql.query(
    `SELECT (ROUND(local_score * 2) / 2)::FLOAT AS lx, ROUND(ai_score)::INT AS ay, COUNT(*)::INT AS c
     FROM sites WHERE ai_score IS NOT NULL AND local_score IS NOT NULL
     GROUP BY 1, 2`
  )) as { lx: number; ay: number; c: number }[];
  const heatmapMax = cells.reduce((m, c) => Math.max(m, c.c), 0);

  // Mean AI + interquartile range per local_score bucket. Same filtered row
  // set as `correlation`/`scored`, so the caption's r and N match the chart.
  const meanLine = (await sql.query(
    `SELECT local_score::FLOAT AS local, COUNT(*)::INT AS n,
            ROUND(AVG(ai_score)::NUMERIC, 2)::FLOAT AS avg,
            PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ai_score)::FLOAT AS p25,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ai_score)::FLOAT AS p75
     FROM sites WHERE ai_score IS NOT NULL AND local_score IS NOT NULL
     GROUP BY local_score ORDER BY local_score`
  )) as { local: number; n: number; avg: number; p25: number; p75: number }[];

  // Integer-bucket counts per score, both metrics, for the distribution curves.
  const distRows = (await sql.query(
    `SELECT score,
            SUM(CASE WHEN kind = 'local' THEN n ELSE 0 END)::INT AS local_n,
            SUM(CASE WHEN kind = 'ai' THEN n ELSE 0 END)::INT AS ai_n
     FROM (
       SELECT ROUND(local_score)::INT AS score, 'local' AS kind, COUNT(*) AS n
       FROM sites WHERE local_score IS NOT NULL GROUP BY 1
       UNION ALL
       SELECT ROUND(ai_score)::INT, 'ai', COUNT(*)
       FROM sites WHERE ai_score IS NOT NULL GROUP BY 1
     ) t GROUP BY score ORDER BY score`
  )) as { score: number; local_n: number; ai_n: number }[];
  const distributions = distRows.map((r) => ({
    score: r.score,
    localN: r.local_n,
    aiN: r.ai_n,
  }));

  return {
    bySource,
    totals,
    failures,
    scored,
    correlation,
    distributions,
    meanLine,
    heatmap: cells,
    heatmapMax,
  };
}

/** Live queue depths used for pipeline progress bars. */
export async function getProgressCounts(): Promise<{
  pending: number;
  localPending: number;
  aiPending: number;
}> {
  const sql = readSql();
  const rows = (await sql.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('pending','crawling'))::INT AS pending,
       COUNT(*) FILTER (WHERE status IN ('done','analyzed')
                          AND local_score IS NULL
                          AND screenshot_path IS NOT NULL)::INT AS local_pending,
       COUNT(*) FILTER (WHERE status = 'done' AND analyzed_at IS NULL)::INT AS ai_pending
     FROM sites`,
    []
  )) as { pending: number; local_pending: number; ai_pending: number }[];
  const r = rows[0];
  return { pending: r.pending, localPending: r.local_pending, aiPending: r.ai_pending };
}

/** Per-source/status rollup + failure list for a set of ids (refetch summary). */
export async function summarizeSites(ids: number[]): Promise<{
  bySourceStatus: { source: string; status: string; count: number }[];
  failures: { url: string; failure_type: string | null; error: string | null }[];
}> {
  const sql = readSql();
  const [bySourceStatus, failures] = (await Promise.all([
    sql.query(
      `SELECT source, status, COUNT(*)::INT AS count FROM sites
       WHERE id = ANY($1) GROUP BY source, status ORDER BY source, status`,
      [ids]
    ),
    sql.query(
      `SELECT url, (${FAILURE_CASE}) AS failure_type, error FROM sites
       WHERE id = ANY($1) AND status='failed' ORDER BY url`,
      [ids]
    ),
  ])) as [
    { source: string; status: string; count: number }[],
    { url: string; failure_type: string | null; error: string | null }[],
  ];
  return { bySourceStatus, failures };
}

/**
 * Force rows back to `pending` for refetch (write role required).
 * Clears analyzed_at + local_score so both scoring passes re-run after the
 * crawl. Scores/feedback stay until the pipeline overwrites them.
 */
export async function resetForRefetch(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = (await writeSql().query(
    `UPDATE sites
     SET status='pending', error=NULL, screenshot_path=NULL,
         analyzed_at=NULL, local_score=NULL
     WHERE id = ANY($1) RETURNING id`,
    [ids]
  )) as { id: number }[];
  return rows.length;
}
