"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CATEGORIES,
  FAILURE_TYPES,
  STATUSES,
  type Site,
  type SiteFilters,
  type SitesResponse,
} from "@/lib/types";
import { filtersToSearchParams } from "@/lib/filters";
import {
  dateInputToEpoch,
  domainSlug,
  formatDate,
  formatNumber,
} from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  FailureBadge,
  MultiSelect,
  ScorePill,
  SourceBadge,
  Spinner,
  StatusBadge,
} from "./ui";
import { DateField } from "./date-field";
import { screenshotUrl } from "@/lib/img";

const SOURCES = ["cc", "wb", "unknown"];

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  className?: string;
}

const COLUMNS: Column[] = [
  { key: "screenshot", label: "" },
  { key: "url", label: "Domain", sortable: true },
  { key: "source", label: "Source", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "failure", label: "Failure" },
  { key: "ai_score", label: "AI score", sortable: true },
  { key: "local_score", label: "Local", sortable: true },
  { key: "category", label: "Category", sortable: true },
  { key: "crawled_at", label: "Crawled", sortable: true },
];

export function SitesTable({ imgDomain = null }: { imgDomain?: string | null }) {
  // filter inputs (uncontrolled debounce for search)
  const [q, setQ] = useState("");
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [source, setSource] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [failure, setFailure] = useState<string[]>([]);
  const [category, setCategory] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [sort, setSort] = useState("id");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [data, setData] = useState<SitesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const debouncedQ = useDebounced(q, 300);

  const filters: SiteFilters = useMemo(
    () => ({
      q: debouncedQ || undefined,
      scoreMin: scoreMin === "" ? undefined : Number(scoreMin),
      scoreMax: scoreMax === "" ? undefined : Number(scoreMax),
      source: source.length ? source : undefined,
      status: status.length ? (status as SiteFilters["status"]) : undefined,
      failure: failure.length ? (failure as SiteFilters["failure"]) : undefined,
      category: category.length ? category : undefined,
      crawledFrom: dateInputToEpoch(dateFrom),
      crawledTo: dateInputToEpoch(dateTo, true),
    }),
    [debouncedQ, scoreMin, scoreMax, source, status, failure, category, dateFrom, dateTo]
  );

  const hasFilters =
    !!debouncedQ || scoreMin !== "" || scoreMax !== "" || source.length > 0 ||
    status.length > 0 || failure.length > 0 || category.length > 0 ||
    dateFrom !== "" || dateTo !== "";

  // reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filters]);

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      const sp = filtersToSearchParams({ ...filters, sort, dir, page, pageSize });
      return fetch(`/api/sites?${sp}`, { signal })
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
          setData(body);
          setError(null);
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setError(String(e.message ?? e));
        })
        .finally(() => setLoading(false));
    },
    [filters, sort, dir, page, pageSize]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const toggleSort = (key: string) => {
    if (sort === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDir(key === "url" ? "asc" : "desc");
    }
    setPage(1);
  };

  const clearFilters = () => {
    setQ("");
    setScoreMin("");
    setScoreMax("");
    setSource([]);
    setStatus([]);
    setFailure([]);
    setCategory([]);
    setDateFrom("");
    setDateTo("");
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const [generating, setGenerating] = useState(false);
  const downloadCsv = async () => {
    if (generating) return; // guard against double-clicks / spam
    setGenerating(true);
    try {
      const sp = filtersToSearchParams({ ...filters, sort, dir });
      const res = await fetch(`/api/export?${sp}`);
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lovable-parser-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header row: title + report button ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Domains</h1>
          <p className="mt-1 text-sm text-ink-2">
            Every discovered lovable.app site — filter and export a report.
          </p>
        </div>
        <Button
          variant="secondary"
          className="mt-1"
          onClick={downloadCsv}
          disabled={generating}
          title="Export the current filtered view as CSV"
        >
          {generating ? <Spinner /> : <DownloadIcon />}
          {generating ? "Generating…" : "Generate report"}
        </Button>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden
          >
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 10 L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search domain or title…"
            className="w-56 rounded-md border border-line-strong bg-card py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-md border border-line-strong bg-card px-2 py-1">
          <span className="text-xs text-ink-3">AI score</span>
          <input
            type="number" min={0} max={10} step={0.5} value={scoreMin} placeholder="min"
            onChange={(e) => setScoreMin(e.target.value)}
            className="w-12 bg-transparent text-sm text-ink focus:outline-none"
          />
          <span className="text-ink-3">–</span>
          <input
            type="number" min={0} max={10} step={0.5} value={scoreMax} placeholder="max"
            onChange={(e) => setScoreMax(e.target.value)}
            className="w-12 bg-transparent text-sm text-ink focus:outline-none"
          />
        </div>

        <MultiSelect
          label="Source" options={SOURCES} selected={source} onChange={setSource}
          renderOption={(v) => <SourceBadge source={v} />}
        />
        <MultiSelect
          label="Status" options={STATUSES} selected={status} onChange={setStatus}
          renderOption={(v) => <StatusBadge status={v} />}
        />
        <MultiSelect
          label="Failure" options={FAILURE_TYPES} selected={failure} onChange={setFailure}
          renderOption={(v) => <FailureBadge type={v} />}
        />
        <MultiSelect label="Category" options={CATEGORIES} selected={category} onChange={setCategory} />

        <div className="flex items-center gap-1.5 rounded-md border border-line-strong bg-card px-2.5 py-1">
          <span className="text-xs text-ink-3">Crawled</span>
          <DateField value={dateFrom} onChange={setDateFrom} label="Crawled from" />
          <span className="text-ink-3">–</span>
          <DateField value={dateTo} onChange={setDateTo} label="Crawled to" />
        </div>

        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Reset
          </Button>
        )}
      </div>

      {/* ── Table ── */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
                {COLUMNS.map((col) => (
                  <th key={col.key} className={`px-3 py-2.5 font-medium ${col.className ?? ""}`}>
                    {col.sortable ? (
                      <button
                        onClick={() => toggleSort(col.key)}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${
                          sort === col.key ? "text-ink" : ""
                        }`}
                      >
                        {col.label}
                        {sort === col.key && (
                          <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
              {rows.map((site) => (
                <Fragment key={site.id}>
                  <tr
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-neutral-soft/60"
                    onClick={() => setExpanded(expanded === site.id ? null : site.id)}
                  >
                    <td className="px-3 py-2">
                      <Thumb site={site} imgDomain={imgDomain} />
                    </td>
                    <td className="max-w-64 px-3 py-2">
                      <div className="truncate font-medium text-ink">{domainSlug(site.url)}</div>
                      {site.title && (
                        <div className="truncate text-xs text-ink-3">{site.title}</div>
                      )}
                    </td>
                    <td className="px-3 py-2"><SourceBadge source={site.source} /></td>
                    <td className="px-3 py-2"><StatusBadge status={site.status} /></td>
                    <td className="px-3 py-2"><FailureBadge type={site.failure_type} /></td>
                    <td className="px-3 py-2"><ScorePill score={site.ai_score} /></td>
                    <td className="px-3 py-2 tabular-nums text-ink-2">
                      {site.local_score != null ? site.local_score.toFixed(1) : <span className="text-ink-3">—</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-2">{site.category ?? <span className="text-ink-3">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">{formatDate(site.crawled_at)}</td>
                  </tr>
                  {expanded === site.id && (
                    <tr className="border-b border-line bg-surface">
                      <td colSpan={COLUMNS.length} className="px-5 py-4">
                        <ExpandedRow site={site} imgDomain={imgDomain} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-ink-3">
                    {error ? (
                      <span className="text-bad-text">{error}</span>
                    ) : (
                      "No sites match the current filters."
                    )}
                  </td>
                </tr>
              )}
              {rows.length === 0 && loading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-ink-3">
                    <span className="inline-flex items-center gap-2"><Spinner /> Loading…</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination footer ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm text-ink-2">
          <span>
            {formatNumber(total)} site{total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="rounded-md border border-line-strong bg-card px-2 py-1 text-sm focus:outline-none"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
              ←
            </Button>
            <span className="tabular-nums">
              {page} / {formatNumber(pageCount)}
            </span>
            <Button variant="secondary" onClick={() => setPage((p) => p + 1)} disabled={page >= pageCount}>
              →
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ── Row details ────────────────────────────────────────────────────── */

function Thumb({ site, imgDomain }: { site: Site; imgDomain: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = screenshotUrl(imgDomain, site.screenshot_key);
  if (!src || failed) {
    return <div className="h-10 w-16 rounded border border-line bg-neutral-soft" aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={64}
      height={40}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-10 w-16 rounded border border-line object-cover object-top"
    />
  );
}

function ExpandedRow({ site, imgDomain }: { site: Site; imgDomain: string | null }) {
  const src = screenshotUrl(imgDomain, site.screenshot_key);
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {src && (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`Screenshot of ${site.url}`}
            width={1280}
            height={800}
            loading="lazy"
            className="h-auto w-full max-w-sm rounded-lg border border-line shadow-sm"
          />
        </a>
      )}
      <dl className="grid flex-1 grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 self-start">
        <Detail label="URL">
          <a
            href={site.url} target="_blank" rel="noreferrer"
            className="text-accent-text underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {site.url}
          </a>
        </Detail>
        <Detail label="Title">{site.title || "—"}</Detail>
        <Detail label="AI score"><ScorePill score={site.ai_score} /></Detail>
        <Detail label="Local score">
          {site.local_score != null ? site.local_score.toFixed(1) : "—"}
          {site.dom_nodes != null && (
            <span className="ml-2 text-xs text-ink-3">{site.dom_nodes} DOM nodes</span>
          )}
        </Detail>
        <Detail label="Category">{site.category ?? "—"}</Detail>
        <Detail label="Discovered">{formatDate(site.created_at)}</Detail>
        <Detail label="Crawled">{formatDate(site.crawled_at)}</Detail>
        <Detail label="Analyzed">{formatDate(site.analyzed_at)}</Detail>
        <Detail label="Source"><SourceBadge source={site.source} /></Detail>
        {site.ai_feedback && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">AI feedback</dt>
            <dd className="mt-0.5 text-ink-2">{site.ai_feedback}</dd>
          </div>
        )}
        {site.error && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Error <Badge tone="bad">{site.failure_type}</Badge>
            </dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-bad-text">{site.error}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="text-accent">
      <path d="M8 2 V10 M5 7.5 L8 10.5 L11 7.5 M3 13 H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

