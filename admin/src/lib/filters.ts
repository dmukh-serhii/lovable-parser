import type { FailureType, SiteFilters, SiteStatus } from "./types";

/** Parse table filters from URL search params (shared by sites/export/refetch). */
export function filtersFromSearchParams(sp: URLSearchParams): SiteFilters {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const list = (k: string) => {
    const v = sp.getAll(k).flatMap((s) => s.split(","));
    const cleaned = v.map((s) => s.trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  };

  return {
    q: sp.get("q") || undefined,
    scoreMin: num("scoreMin"),
    scoreMax: num("scoreMax"),
    source: list("source"),
    status: list("status") as SiteStatus[] | undefined,
    failure: list("failure") as FailureType[] | undefined,
    category: list("category"),
    crawledFrom: num("crawledFrom"),
    crawledTo: num("crawledTo"),
    sort: sp.get("sort") || undefined,
    dir: sp.get("dir") === "asc" ? "asc" : sp.get("dir") === "desc" ? "desc" : undefined,
    page: num("page"),
    pageSize: num("pageSize"),
  };
}

/** Serialize filters back to search params (client-side). */
export function filtersToSearchParams(f: SiteFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.scoreMin !== undefined) sp.set("scoreMin", String(f.scoreMin));
  if (f.scoreMax !== undefined) sp.set("scoreMax", String(f.scoreMax));
  if (f.source?.length) sp.set("source", f.source.join(","));
  if (f.status?.length) sp.set("status", f.status.join(","));
  if (f.failure?.length) sp.set("failure", f.failure.join(","));
  if (f.category?.length) sp.set("category", f.category.join(","));
  if (f.crawledFrom !== undefined) sp.set("crawledFrom", String(f.crawledFrom));
  if (f.crawledTo !== undefined) sp.set("crawledTo", String(f.crawledTo));
  if (f.sort) sp.set("sort", f.sort);
  if (f.dir) sp.set("dir", f.dir);
  if (f.page) sp.set("page", String(f.page));
  if (f.pageSize) sp.set("pageSize", String(f.pageSize));
  return sp;
}
