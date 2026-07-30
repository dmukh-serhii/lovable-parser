/** Row shape of the `sites` table in Neon Postgres (see scripts/migrate_to_neon.py). */
export interface Site {
  id: number;
  url: string;
  source: string; // 'cc' | 'wb' | 'unknown'
  status: SiteStatus;
  screenshot_path: string | null;
  screenshot_key: string | null; // R2 object key once uploaded
  error: string | null;
  created_at: number; // unix epoch seconds
  crawled_at: number | null;
  analyzed_at: number | null;
  ai_score: number | null; // Gemini Vision 1-10
  local_score: number | null; // deterministic heuristics 0-10 — separate, never merged
  dom_nodes: number | null;
  category: string | null;
  ai_feedback: string | null;
  title: string | null;
  notified_at: number | null;
  /** Derived in SQL from `error` — not a stored column. */
  failure_type: FailureType | null;
}

export type SiteStatus =
  | "pending"
  | "crawling"
  | "done"
  | "analyzed"
  | "not_found"
  | "failed";

/**
 * Derived failure classification. Mirrors the pipeline's own semantics:
 * crawl.js PERMANENT_ERRORS + db.js resetTransientFailed() treat
 * dns / unreachable / cert / aborted as permanent; the rest are transient
 * and eligible for `npm run crawl:retry`.
 */
export type FailureType =
  | "dns"
  | "unreachable"
  | "cert"
  | "aborted"
  | "timeout"
  | "connection"
  | "other";

export const PERMANENT_FAILURES: FailureType[] = [
  "dns",
  "unreachable",
  "cert",
  "aborted",
];

export const STATUSES: SiteStatus[] = [
  "pending",
  "crawling",
  "done",
  "analyzed",
  "not_found",
  "failed",
];

export const FAILURE_TYPES: FailureType[] = [
  "dns",
  "unreachable",
  "cert",
  "aborted",
  "timeout",
  "connection",
  "other",
];

export const CATEGORIES = [
  "landing-page",
  "portfolio",
  "saas",
  "ecommerce",
  "blog",
  "dashboard",
  "other",
];

export interface SiteFilters {
  q?: string; // text search on url + title
  scoreMin?: number; // on ai_score
  scoreMax?: number; // on ai_score
  source?: string[];
  status?: SiteStatus[];
  failure?: FailureType[];
  category?: string[];
  crawledFrom?: number; // unix epoch seconds
  crawledTo?: number;
  sort?: string; // column name
  dir?: "asc" | "desc";
  page?: number; // 1-based
  pageSize?: number;
}

export interface SitesResponse {
  rows: Site[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MethodologyData {
  /** Per-source discovery + crawl outcome breakdown. */
  bySource: {
    source: string;
    discovered: number;
    screenshotted: number;
    failed: number;
    notFound: number;
  }[];
  totals: {
    discovered: number;
    screenshotted: number; // status in (done, analyzed)
    analyzed: number; // has ai_score
    failed: number;
    notFound: number;
    pending: number;
    crawlAttempted: number; // screenshotted + failed + notFound
  };
  /** Failure-type breakdown among failed rows (mirrors pipeline classification). */
  failures: { type: string; count: number }[];
  scored: number; // rows with both ai_score and local_score
  correlation: number | null; // Pearson corr(ai, local) — same row set as the chart
  /** Integer-bucket counts per score for both metrics (distribution curves). */
  distributions: { score: number; localN: number; aiN: number }[];
  /** Mean AI score + IQR per local_score bucket (retained agreement-line chart). */
  meanLine: { local: number; n: number; avg: number; p25: number; p75: number }[];
  /** Heatmap cells (kept for the retained heatmap component; not rendered on the page). */
  heatmap: { lx: number; ay: number; c: number }[];
  heatmapMax: number;
}

export interface StatsResponse {
  total: number;
  byStatus: { status: string; count: number }[];
  bySource: { source: string; status: string; count: number }[];
  scoreDistribution: { score: number; count: number }[];
  avgScore: number | null;
  analyzedCount: number;
  failedCount: number;
  categories: { category: string; count: number; avgScore: number }[];
  lastCrawledAt: number | null;
}
