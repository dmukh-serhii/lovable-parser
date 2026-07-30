#!/usr/bin/env python3
"""
Step 1 — Fetch all lovable.app subdomains.

Sources:
  - CommonCrawl CDX API  (always)
  - Wayback Machine CDX  (when USE_WAYBACK=true in .env)

Always merges results into data/domains.txt without duplicates.
Safe to re-run — only new domains are appended.
"""
import asyncio
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from dotenv import load_dotenv

load_dotenv()

# Windows consoles default to a legacy codepage that can't encode ⚠/…
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# ── Config ────────────────────────────────────────────────────────────────────

CC_BASE        = "https://index.commoncrawl.org"
WB_BASE        = "https://web.archive.org/cdx/search/cdx"
USE_WAYBACK    = os.getenv("USE_WAYBACK", "false").lower() == "true"
CONCURRENCY    = int(os.getenv("CC_CONCURRENCY", "5"))
WB_CONCURRENCY = int(os.getenv("WB_CONCURRENCY", "3"))
WB_MAX_PAGES   = int(os.getenv("WB_MAX_PAGES", "0"))  # 0 = no limit (for testing)
FETCH_LIMIT    = int(os.getenv("FETCH_LIMIT",  "0"))  # 0 = no limit; caps domains per source

# Indexes older than this predate Lovable (launched ~Feb 2024)
CC_MIN_INDEX = "CC-MAIN-2024-10"

# Hardcoded fallback — used when the live index list can't be fetched.
# Override with CC_INDEX env var to pin to a single index.
CC_INDEXES = [
    # 2026
    "CC-MAIN-2026-17-index",
    "CC-MAIN-2026-12-index",
    "CC-MAIN-2026-08-index",
    "CC-MAIN-2026-04-index",
    # 2025
    "CC-MAIN-2025-51-index",
    "CC-MAIN-2025-47-index",
    "CC-MAIN-2025-43-index",
    "CC-MAIN-2025-38-index",
    "CC-MAIN-2025-33-index",
    "CC-MAIN-2025-30-index",
    "CC-MAIN-2025-26-index",
    "CC-MAIN-2025-21-index",
    "CC-MAIN-2025-18-index",
    "CC-MAIN-2025-13-index",
    "CC-MAIN-2025-08-index",
    "CC-MAIN-2025-05-index",
    # 2024 (Lovable launched ~Feb 2024)
    "CC-MAIN-2024-51-index",
    "CC-MAIN-2024-46-index",
    "CC-MAIN-2024-42-index",
    "CC-MAIN-2024-38-index",
    "CC-MAIN-2024-33-index",
    "CC-MAIN-2024-30-index",
    "CC-MAIN-2024-26-index",
    "CC-MAIN-2024-22-index",
    "CC-MAIN-2024-18-index",
    "CC-MAIN-2024-10-index",
]


# ── URL normalisation ─────────────────────────────────────────────────────────

def normalize(raw_url: str) -> str | None:
    try:
        host = urlparse(raw_url).hostname or ""
        if host.endswith(".lovable.app") and host != "lovable.app":
            slug = host[: -len(".lovable.app")]
            if re.fullmatch(r"[a-z0-9][a-z0-9\-]*", slug):
                return f"https://{host}"
    except Exception:
        pass
    return None


# ── CommonCrawl ───────────────────────────────────────────────────────────────

async def cc_page_count(session: aiohttp.ClientSession, index: str) -> int:
    url = f"{CC_BASE}/{index}?url=*.lovable.app&output=json&showNumPages=true"
    for attempt in range(4):
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status in (503, 504):
                wait = 15 * (attempt + 1)
                print(f"    [{index}] {r.status} — retrying in {wait}s…")
                await asyncio.sleep(wait)
                continue
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status}")
            text = (await r.text()).strip()
            if text.startswith("<"):
                raise RuntimeError(f"got HTML (status {r.status})")
            # API returns plain int OR {"pages": N, ...}
            try:
                return int(text)
            except ValueError:
                return int(json.loads(text)["pages"])
    raise RuntimeError("failed after 4 attempts")


# Statuses worth retrying — CC index servers 503 constantly under load
RETRYABLE = {429, 500, 502, 503, 504}
CC_PAGE_ATTEMPTS = 5


async def cc_fetch_page(
    session: aiohttp.ClientSession,
    index: str,
    page: int,
    total: int,
    sem: asyncio.Semaphore,
    counter: list,           # mutable [done] so we can update from coroutine
    failed: list,            # mutable [count] — pages lost after all retries
) -> set[str]:
    results: set[str] = set()
    url = f"{CC_BASE}/{index}?url=*.lovable.app&output=json&fl=url&page={page}"
    last = "unknown"
    async with sem:
        for attempt in range(CC_PAGE_ATTEMPTS):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=60)) as r:
                    if r.status in RETRYABLE:
                        last = f"HTTP {r.status}"
                        await asyncio.sleep(8 * (attempt + 1))
                        continue
                    if r.status != 200:
                        # non-retryable — give up loudly, not silently
                        last = f"HTTP {r.status}"
                        break
                    for line in (await r.text()).splitlines():
                        if not line:
                            continue
                        try:
                            normed = normalize(json.loads(line).get("url", ""))
                            if normed:
                                results.add(normed)
                        except json.JSONDecodeError:
                            pass
                    counter[0] += 1
                    print(f"    [{index}] page {counter[0]}/{total}  (+{len(results)} urls)", end="\r")
                    return results
            except Exception as e:
                last = str(e) or type(e).__name__
                await asyncio.sleep(3 * (attempt + 1))

    counter[0] += 1
    failed[0] += 1
    print(f"    [{index}] page {page} LOST after {CC_PAGE_ATTEMPTS} attempts: {last}")
    return results


async def fetch_cc_index(
    session: aiohttp.ClientSession,
    index: str,
    sem: asyncio.Semaphore,
    report: dict,            # index → {"domains": n, "pages": n, "failed_pages": n}
) -> set[str]:
    print(f"  [CC] {index} — querying…")
    try:
        total = await cc_page_count(session, index)
    except Exception as e:
        msg = str(e) or type(e).__name__
        print(f"  [CC] {index} — skipped: {msg}")
        report[index] = {"domains": 0, "pages": 0, "failed_pages": -1}  # -1 = index skipped
        return set()

    if total == 0:
        print(f"  [CC] {index} — 0 pages (no lovable.app data)")
        report[index] = {"domains": 0, "pages": 0, "failed_pages": 0}
        return set()

    print(f"  [CC] {index} — {total} page(s), fetching…")
    counter = [0]
    failed = [0]
    tasks = [cc_fetch_page(session, index, p, total, sem, counter, failed) for p in range(total)]
    domains: set[str] = set()
    for coro in asyncio.as_completed(tasks):
        domains |= await coro
    suffix = f", {failed[0]} page(s) LOST" if failed[0] else ""
    print(f"  [CC] {index} — done  ({len(domains)} domains{suffix})          ")
    report[index] = {"domains": len(domains), "pages": total, "failed_pages": failed[0]}
    return domains


async def fetch_cc_index_list(session: aiohttp.ClientSession) -> list[str]:
    """
    Fetch the current index list from collinfo.json, keeping only indexes
    since Lovable launched. Falls back to the hardcoded CC_INDEXES list on
    any failure (collinfo.json lives on different infra and can time out).
    Logs which source was used.
    """
    try:
        async with session.get(
            f"{CC_BASE}/collinfo.json", timeout=aiohttp.ClientTimeout(total=15)
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status}")
            data = await r.json(content_type=None)

        ids = [
            c["id"] + "-index"
            for c in data
            if isinstance(c, dict) and str(c.get("id", "")).startswith("CC-MAIN-")
        ]
        # CC-MAIN-YYYY-WW sorts lexicographically (weeks are zero-padded)
        ids = [i for i in ids if i[: len(CC_MIN_INDEX)] >= CC_MIN_INDEX]
        if not ids:
            raise RuntimeError("empty index list")

        ids.sort(reverse=True)  # newest first, same order as the fallback
        print(f"[CommonCrawl] index list: live ({len(ids)} indexes since {CC_MIN_INDEX})")
        return ids
    except Exception as e:
        msg = str(e) or type(e).__name__
        print(f"[CommonCrawl] index list: fallback (hardcoded {len(CC_INDEXES)} indexes) — {msg}")
        return CC_INDEXES


async def cc_reachable(session: aiohttp.ClientSession) -> bool:
    """
    Probe a real index endpoint. CC's index servers are chronically
    overloaded — a single 503 or slow response does NOT mean unreachable,
    so retry with backoff before giving up, and say why we gave up.
    """
    url = f"{CC_BASE}/CC-MAIN-2025-08-index?url=*.lovable.app&output=json&showNumPages=true"
    last = "unknown"
    for attempt in range(3):
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=25)) as r:
                if r.status == 200:
                    return True
                last = f"HTTP {r.status}"
                if r.status == 403:
                    # 403 is the one status that suggests an actual block
                    print(f"\n  [CC] probe got 403 — possible IP block, not retrying")
                    return False
        except Exception as e:
            last = str(e) or type(e).__name__
        if attempt < 2:
            wait = 15 * (attempt + 1)
            print(f"\n  [CC] probe failed ({last}) — retrying in {wait}s…", end=" ", flush=True)
            await asyncio.sleep(wait)
    print(f"\n  [CC] probe gave up after 3 attempts (last: {last})")
    return False


async def fetch_commoncrawl(session: aiohttp.ClientSession, page_sem: asyncio.Semaphore, latest_only: bool = False) -> set[str]:
    print(f"\n[CommonCrawl] checking connectivity…", end=" ", flush=True)
    if not await cc_reachable(session):
        print("UNREACHABLE — skipping all indexes")
        print("  Tip: use  npm run fetch:wayback  instead")
        return set()
    print("OK")

    env = os.getenv("CC_INDEX")
    if env:
        idx = env if env.endswith("-index") else env + "-index"
        indexes = [idx]
    else:
        indexes = await fetch_cc_index_list(session)
        if latest_only:
            indexes = [indexes[0]]

    print(f"[CommonCrawl] querying {len(indexes)} index(es)…")

    # One index at a time with a short pause — CC rate-limits hard on concurrent requests
    index_sem = asyncio.Semaphore(2)
    report: dict = {}

    async def fetch_one(idx):
        async with index_sem:
            result = await fetch_cc_index(session, idx, page_sem, report)
            await asyncio.sleep(2)
            return result

    results = await asyncio.gather(*[fetch_one(idx) for idx in indexes])
    combined: set[str] = set()
    for chunk in results:
        combined |= chunk

    # ── Per-index summary — makes silent data loss impossible to miss ──
    skipped = [i for i, r in report.items() if r["failed_pages"] == -1]
    lost = sum(r["failed_pages"] for r in report.values() if r["failed_pages"] > 0)
    print(f"\n[CommonCrawl] per-index results:")
    for idx in indexes:
        r = report.get(idx)
        if not r:
            continue
        status = ("SKIPPED" if r["failed_pages"] == -1
                  else f"{r['domains']:>6} domains / {r['pages']} page(s)"
                       + (f"  ⚠ {r['failed_pages']} LOST" if r["failed_pages"] else ""))
        print(f"  {idx:<28} {status}")
    print(f"[CommonCrawl] TOTAL unique: {len(combined)}"
          f"  ({len(indexes) - len(skipped)}/{len(indexes)} indexes ok"
          f", {lost} pages lost)")
    if skipped:
        print(f"[CommonCrawl] skipped indexes: {', '.join(skipped)} — re-run to fill gaps")
    return combined


# ── Wayback Machine ───────────────────────────────────────────────────────────

async def wb_page_count(session: aiohttp.ClientSession) -> int:
    # Note: no fl/collapse here — they affect the count and return 0
    params = {"url": "*.lovable.app", "output": "json", "showNumPages": "true"}
    for attempt in range(4):
        async with session.get(WB_BASE, params=params, timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status == 503:
                wait = 10 * (attempt + 1)
                print(f"  [WB] 503 — retrying in {wait}s…")
                await asyncio.sleep(wait)
                continue
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status}")
            text = (await r.text()).strip()
            if text.startswith("<"):
                raise RuntimeError(f"got HTML (status {r.status})")
            data = json.loads(text)
            # Wayback returns [["numpages"], ["36"]]
            if isinstance(data, list):
                val = data[1][0] if len(data) > 1 and data[1] else 0
                return int(val) if val is not None else 0
            if isinstance(data, dict):
                return int(data["pages"])
            return int(data)
    raise RuntimeError("failed after 4 attempts")


async def wb_fetch_page(
    session: aiohttp.ClientSession,
    page: int,
    total: int,
    sem: asyncio.Semaphore,
    counter: list,
    failed: list,
) -> set[str]:
    results: set[str] = set()
    params = {"url": "*.lovable.app", "output": "json",
              "fl": "original", "collapse": "urlkey", "page": str(page)}
    last = "unknown"
    async with sem:
        for attempt in range(5):
            try:
                async with session.get(WB_BASE, params=params, timeout=aiohttp.ClientTimeout(total=60)) as r:
                    if r.status in RETRYABLE:
                        last = f"HTTP {r.status}"
                        await asyncio.sleep(10 * (attempt + 1))
                        continue
                    if r.status != 200:
                        last = f"HTTP {r.status}"
                        break
                    data = await r.json(content_type=None)
                    for row in data[1:]:   # first row is header
                        if row:
                            normed = normalize(row[0])
                            if normed:
                                results.add(normed)
                    counter[0] += 1
                    print(f"  [WB] page {counter[0]}/{total}  (+{len(results)} urls)", end="\r")
                    await asyncio.sleep(1)
                    return results
            except Exception as e:
                last = str(e) or type(e).__name__
                await asyncio.sleep(5 * (attempt + 1))

    counter[0] += 1
    failed[0] += 1
    print(f"  [WB] page {page} LOST after 5 attempts: {last}")
    await asyncio.sleep(1)
    return results


async def fetch_wayback(session: aiohttp.ClientSession, sem: asyncio.Semaphore) -> set[str]:
    print("\n[Wayback Machine] getting page count…")
    try:
        total = await wb_page_count(session)
    except Exception as e:
        msg = str(e) or type(e).__name__
        print(f"  [WB] skipped: {msg}")
        return set()

    if total == 0:
        print("  [WB] 0 pages — no lovable.app data in Wayback index")
        return set()

    if WB_MAX_PAGES > 0:
        total = min(total, WB_MAX_PAGES)
        print(f"  [WB] limited to {total} page(s) (WB_MAX_PAGES)")

    print(f"  [WB] {total} page(s), fetching…")
    wb_sem = asyncio.Semaphore(WB_CONCURRENCY)
    counter = [0]
    failed = [0]
    tasks = [wb_fetch_page(session, p, total, wb_sem, counter, failed) for p in range(total)]
    domains: set[str] = set()
    for coro in asyncio.as_completed(tasks):
        domains |= await coro
    suffix = f", {failed[0]} page(s) LOST" if failed[0] else ""
    print(f"  [WB] done  ({len(domains)} domains{suffix})          ")
    return domains


# ── Save — merge without duplicates ──────────────────────────────────────────

def save_domains(new_domains: set[str], source: str) -> set[str]:
    out = Path(f"data/domains_{source}.txt")
    existing: set[str] = set()
    if out.exists():
        existing = {line for line in out.read_text().splitlines() if line.startswith("http")}

    before = len(existing)
    merged = existing | new_domains
    out.write_text("\n".join(sorted(merged)))

    added = len(merged) - before
    print(f"\ndomains_{source}.txt: {before} existing + {added} new = {len(merged)} total")
    return merged


# ── Main ──────────────────────────────────────────────────────────────────────

async def main() -> None:
    import sys
    wayback_only = "--wayback-only" in sys.argv
    cc_only      = "--cc-only"      in sys.argv
    latest_only  = "--latest-only"  in sys.argv

    Path("data").mkdir(exist_ok=True)

    sem = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    async with aiohttp.ClientSession(connector=connector, headers=headers) as session:
        coros = []
        tags  = []

        if not wayback_only:
            coros.append(fetch_commoncrawl(session, sem, latest_only=latest_only))
            tags.append("cc")

        if not cc_only and (USE_WAYBACK or wayback_only):
            coros.append(fetch_wayback(session, sem))
            tags.append("wb")
        elif not cc_only and not wayback_only:
            print("\n[Wayback Machine] skipped (set USE_WAYBACK=true to enable)")

        results = await asyncio.gather(*coros)

    by_source: dict[str, set[str]] = dict(zip(tags, results))
    merged_by_source: dict[str, set[str]] = {}
    for source, domains in by_source.items():
        if FETCH_LIMIT > 0 and len(domains) > FETCH_LIMIT:
            domains = set(sorted(domains)[:FETCH_LIMIT])
            print(f"  [limit] {source} capped at {FETCH_LIMIT} domains (FETCH_LIMIT)")
        merged_by_source[source] = save_domains(domains, source)

    # ── Cross-source dedup report ──
    cc = merged_by_source.get("cc", set())
    wb = merged_by_source.get("wb", set())
    if cc and wb:
        overlap = len(cc & wb)
        print(f"\n── dedup ──")
        print(f"  cc only: {len(cc - wb)}   wb only: {len(wb - cc)}   overlap: {overlap}")
        print(f"  combined unique: {len(cc | wb)}")
        print(f"  (the crawler dedupes on insert — overlapping domains keep their first source tag)")


if __name__ == "__main__":
    asyncio.run(main())
