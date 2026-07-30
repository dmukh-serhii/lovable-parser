#!/usr/bin/env python3
"""
Export crawled sites to CSV/JSON from Postgres (Neon).

Default (no args) — legacy behavior:
  status IN (done, analyzed), MIN_SCORE env filter (on ai_score),
  writes results/results.json and results/results.csv.

With filter args (used by the admin panel's "Generate report"):
  every table filter is available as a flag, and --stdout streams the CSV
  to stdout with the full column set instead of writing files.

  python scripts/export_crawled.py --stdout --status failed --failure timeout
"""
import argparse
import csv
import io
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Windows consoles default to a legacy codepage (e.g. cp1251) which can't
# encode the data or the → in status lines; the admin API also expects UTF-8.
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))
from db import connect  # noqa: E402

MIN_SCORE = float(os.getenv("MIN_SCORE", "0"))

# Failure classification — keep in sync with crawler/crawl.js PERMANENT_ERRORS
# and the admin's FAILURE_CASE in admin/src/lib/db.ts.
FAILURE_CASE = """
  CASE
    WHEN error IS NULL THEN NULL
    WHEN error LIKE '%%ERR_NAME_NOT_RESOLVED%%' THEN 'dns'
    WHEN error LIKE '%%ERR_ADDRESS_UNREACHABLE%%' THEN 'unreachable'
    WHEN error LIKE '%%ERR_CERT_%%' THEN 'cert'
    WHEN error LIKE '%%net::ERR_ABORTED%%' THEN 'aborted'
    WHEN error LIKE '%%imeout%%' THEN 'timeout'
    WHEN error LIKE '%%ERR_CONNECTION%%' THEN 'connection'
    ELSE 'other'
  END"""

SORTABLE = {
    "id", "url", "source", "status", "ai_score", "local_score", "category",
    "title", "created_at", "crawled_at", "analyzed_at", "dom_nodes",
}

FULL_FIELDS = [
    "url", "title", "source", "status", "ai_score", "local_score", "dom_nodes",
    "category", "ai_feedback", "failure_type", "error",
    "created_at", "crawled_at", "analyzed_at", "screenshot",
]

LEGACY_FIELDS = ["url", "title", "source", "ai_score", "local_score", "category", "ai_feedback", "screenshot"]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--search", help="substring match on url or title")
    p.add_argument("--score-min", type=float, help="minimum ai_score")
    p.add_argument("--score-max", type=float, help="maximum ai_score")
    p.add_argument("--source", help="comma list: cc,wb,unknown")
    p.add_argument("--status", help="comma list: pending,crawling,done,analyzed,not_found,failed")
    p.add_argument("--failure", help="comma list: dns,unreachable,cert,aborted,timeout,connection,other")
    p.add_argument("--category", help="comma list of categories")
    p.add_argument("--crawled-from", type=int, help="unix epoch seconds")
    p.add_argument("--crawled-to", type=int, help="unix epoch seconds")
    p.add_argument("--sort", default=None, help=f"one of {sorted(SORTABLE)}")
    p.add_argument("--dir", choices=["asc", "desc"], default="desc")
    p.add_argument("--stdout", action="store_true", help="write CSV (full columns) to stdout instead of files")
    return p.parse_args()


def _csv_list(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def build_query(args: argparse.Namespace) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []

    filtered = any([
        args.search, args.score_min is not None, args.score_max is not None,
        args.source, args.status, args.failure, args.category,
        args.crawled_from is not None, args.crawled_to is not None,
    ])

    if not filtered:
        # Legacy default: done/analyzed with MIN_SCORE env filter
        clauses.append("status IN ('done', 'analyzed')")
        clauses.append("(ai_score >= %s OR ai_score IS NULL)")
        params.append(MIN_SCORE)
    else:
        if args.search:
            clauses.append("(url ILIKE %s OR title ILIKE %s)")
            params += [f"%{args.search}%", f"%{args.search}%"]
        if args.score_min is not None:
            clauses.append("ai_score >= %s")
            params.append(args.score_min)
        if args.score_max is not None:
            clauses.append("ai_score <= %s")
            params.append(args.score_max)
        for column, raw in (("source", args.source), ("status", args.status), ("category", args.category)):
            values = _csv_list(raw)
            if values:
                clauses.append(f"{column} = ANY(%s)")
                params.append(values)
        failures = _csv_list(args.failure)
        if failures:
            clauses.append(f"({FAILURE_CASE}) = ANY(%s)")
            params.append(failures)
        if args.crawled_from is not None:
            clauses.append("crawled_at >= %s")
            params.append(args.crawled_from)
        if args.crawled_to is not None:
            clauses.append("crawled_at <= %s")
            params.append(args.crawled_to)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    sort = args.sort if args.sort in SORTABLE else "ai_score"
    direction = "ASC" if args.dir == "asc" else "DESC"
    order = f"ORDER BY {sort} IS NULL, {sort} {direction}, id ASC"

    sql = (
        f"SELECT url, title, source, status, ai_score, local_score, dom_nodes, "
        f"category, ai_feedback, ({FAILURE_CASE}) AS failure_type, error, "
        f"created_at, crawled_at, analyzed_at, screenshot_path "
        f"FROM sites {where} {order}"
    )
    return sql, params


def fetch_rows(args: argparse.Namespace) -> list[dict]:
    conn = connect()
    sql, params = build_query(args)
    cols = [
        "url", "title", "source", "status", "ai_score", "local_score", "dom_nodes",
        "category", "ai_feedback", "failure_type", "error",
        "created_at", "crawled_at", "analyzed_at", "screenshot",
    ]
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(zip(cols, r))
        d["title"] = d["title"] or ""
        d["source"] = d["source"] or "unknown"
        out.append(d)
    return out


def export_files(results: list[dict]) -> None:
    """Legacy file export — same destinations as before."""
    legacy = [{k: r[k] for k in LEGACY_FIELDS} for r in results]

    out_dir = Path("results")
    out_dir.mkdir(exist_ok=True)

    json_out = out_dir / "results.json"
    json_out.write_text(json.dumps(legacy, indent=2))

    csv_out = out_dir / "results.csv"
    with open(csv_out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=LEGACY_FIELDS)
        writer.writeheader()
        writer.writerows(legacy)

    analyzed = sum(1 for r in results if r["ai_score"] is not None)
    print(f"Exported {len(results)} sites ({analyzed} with AI scores) → {json_out}  |  {csv_out}")


def export_stdout(results: list[dict]) -> None:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FULL_FIELDS)
    writer.writeheader()
    writer.writerows(results)
    sys.stdout.write(buf.getvalue())


def main() -> None:
    args = parse_args()
    results = fetch_rows(args)
    if args.stdout:
        export_stdout(results)
    else:
        export_files(results)


if __name__ == "__main__":
    main()
