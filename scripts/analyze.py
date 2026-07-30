#!/usr/bin/env python3
"""
Scoring pipeline — THE single entry point for all site scoring.

Two independent scores per site, stored in separate columns:
  local_score  deterministic heuristics (scripts/local_score.py) — free, offline
  ai_score     Gemini Vision 1–10 — plus category + feedback

Usage:
  python scripts/analyze.py                # local scores, then AI, then export
  python scripts/analyze.py --local-only   # only the deterministic pass
  python scripts/analyze.py --ai-only      # only the Gemini pass
  python scripts/analyze.py --export-only  # just regenerate results/*.{json,csv}

Raw Gemini responses for the first RAW_SAMPLES sites of each run are appended
to data/gemini_raw_samples.jsonl for manual sanity checks.

Free-tier Gemini Flash limits: ~15 RPM, 1500 RPD → keep GEMINI_CONCURRENCY ≤ 3.
"""
import asyncio
import base64
import csv
import json
import os
import re
import sys
import time
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

load_dotenv()

# Windows consoles default to a legacy codepage (e.g. cp1251) which can't
# encode the progress bar / status glyphs
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))
from db import connect  # noqa: E402
from local_score import score_screenshot  # noqa: E402

# Key is only required for the AI pass — local scoring and export work without it
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
)
CONCURRENCY  = int(os.getenv("GEMINI_CONCURRENCY", "3"))
BATCH_DELAY  = 4  # seconds between batches
DELETE_AFTER = os.getenv("DELETE_SCREENSHOTS_AFTER_ANALYSIS", "false").lower() == "true"
GEMINI_MOCK  = os.getenv("GEMINI_MOCK", "false").lower() == "true"
MIN_SCORE    = float(os.getenv("MIN_SCORE", "0"))  # filter results export; 0 = all
# "derived" → the AI pass computes ai_score from the local metrics instead of
# calling the Vision API; "gemini" → real Vision pass. Honored regardless of
# how analyze.py is launched.
AI_SCORING_MODE = os.getenv("AI_SCORING_MODE", "gemini").lower()

RAW_SAMPLES  = 10
RAW_LOG      = Path("data/gemini_raw_samples.jsonl")

PROMPT = """\
Analyze this website screenshot. Return ONLY valid JSON — no markdown, no explanation.

{
  "score": <integer 1-10>,
  "category": "<landing-page | portfolio | saas | ecommerce | blog | dashboard | other>",
  "feedback": "<one or two sentences on design quality, key strength, key weakness>"
}

Scoring:
1-3  broken or very poor
4-6  average / functional
7-8  clean and professional
9-10 polished and impressive"""


# ── Local (deterministic) scoring ─────────────────────────────────────────────

def run_local_scoring() -> None:
    conn = connect()
    rows = conn.execute(
        "SELECT id, screenshot_path, dom_nodes FROM sites "
        "WHERE status IN ('done', 'analyzed') AND local_score IS NULL "
        "AND screenshot_path IS NOT NULL"
    ).fetchall()

    if not rows:
        print("[local] nothing to score")
        conn.close()
        return

    print(f"[local] scoring {len(rows)} screenshot(s)…")
    scored = 0
    missing = 0
    with conn.cursor() as cur:
        for site_id, path, dom_nodes in rows:
            p = Path(path)
            if not p.exists():
                missing += 1
                continue
            try:
                result = score_screenshot(p, dom_nodes)
            except Exception as e:
                print(f"[local] id={site_id} unreadable image: {e}")
                continue
            cur.execute(
                "UPDATE sites SET local_score=%s WHERE id=%s",
                (result["local_score"], site_id),
            )
            scored += 1
            # commit in small batches so external progress polling sees movement
            if scored % 25 == 0:
                conn.commit()
            if scored % 100 == 0:
                print(f"[local] {scored}/{len(rows)}")
    conn.commit()
    conn.close()
    print(f"[local] done — {scored} scored" + (f", {missing} missing screenshots" if missing else ""))


# ── AI scoring (Gemini Vision) ────────────────────────────────────────────────

def get_unanalyzed() -> list[tuple]:
    conn = connect()
    # Rows that have a screenshot but no ai_score yet. Selection is keyed on
    # the ai_score field, so a fresh run scores exactly what is unscored.
    rows = conn.execute(
        "SELECT id, url, screenshot_path FROM sites "
        "WHERE screenshot_path IS NOT NULL AND ai_score IS NULL "
        "AND status IN ('done', 'analyzed')"
    ).fetchall()
    conn.close()
    return rows


def save_batch(results: list[dict]) -> None:
    conn = connect()
    with conn.cursor() as cur:
        cur.executemany(
            """UPDATE sites
               SET ai_score=%s, category=%s, ai_feedback=%s,
                   analyzed_at=EXTRACT(EPOCH FROM now())::BIGINT, status='analyzed'
               WHERE id=%s""",
            [(r["score"], r["category"], r["feedback"], r["id"]) for r in results],
        )
    conn.commit()
    conn.close()

    if DELETE_AFTER:
        for r in results:
            p = Path(r.get("screenshot_path") or "")
            if p.exists():
                p.unlink()


_MOCK_CATEGORIES = ["landing-page", "portfolio", "saas", "ecommerce", "blog", "dashboard", "other"]

def _mock_result(site_id: int, url: str, screenshot_path: str) -> dict:
    import random
    return {
        "id": site_id,
        "url": url,
        "screenshot_path": screenshot_path,
        "score": float(random.randint(1, 10)),
        "category": random.choice(_MOCK_CATEGORIES),
        "feedback": "Mock analysis — pipeline test mode. Design appears functional.",
    }


_raw_logged = 0

def _log_raw_sample(url: str, response: dict) -> None:
    """Append the first RAW_SAMPLES raw Gemini responses per run for manual review."""
    global _raw_logged
    if _raw_logged >= RAW_SAMPLES:
        return
    _raw_logged += 1
    RAW_LOG.parent.mkdir(exist_ok=True)
    with open(RAW_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "ts": int(time.time()),
            "model": GEMINI_MODEL,
            "url": url,
            "response": response,
        }) + "\n")


async def analyze_one(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    site_id: int,
    url: str,
    screenshot_path: str,
) -> dict | None:
    img = Path(screenshot_path)
    if not img.exists():
        print(f"  missing screenshot: {screenshot_path}")
        return None

    if GEMINI_MOCK:
        return _mock_result(site_id, url, screenshot_path)

    img_b64 = base64.b64encode(img.read_bytes()).decode()
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": PROMPT},
                    {"inline_data": {"mime_type": "image/png", "data": img_b64}},
                ]
            }
        ],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1024},
    }

    async with sem:
        for attempt in range(3):
            try:
                async with session.post(
                    GEMINI_URL, json=payload, timeout=aiohttp.ClientTimeout(total=45)
                ) as r:
                    if r.status == 429:
                        body = await r.json(content_type=None)
                        msg = body.get("error", {}).get("message", str(body))
                        wait = 15 * (attempt + 1)
                        print(f"  rate-limited ({msg}), waiting {wait}s…")
                        await asyncio.sleep(wait)
                        continue
                    data = await r.json()

                    if "error" in data:
                        code = data["error"].get("code", r.status)
                        msg  = data["error"].get("message", "unknown")
                        print(f"  Gemini API error {code}: {msg}")
                        # 400/404 are not transient — no point retrying
                        if r.status in (400, 404):
                            return None
                        await asyncio.sleep(3)
                        continue

                    _log_raw_sample(url, data)

                    if "candidates" not in data:
                        # Happens when content is blocked (promptFeedback)
                        reason = data.get("promptFeedback", {}).get("blockReason", "unknown")
                        print(f"  no candidates — blocked: {reason}")
                        return None

                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    match = re.search(r"\{.*\}", text, re.DOTALL)
                    if not match:
                        return None
                    parsed = json.loads(match.group())
                    return {
                        "id": site_id,
                        "url": url,
                        "screenshot_path": screenshot_path,
                        "score": float(parsed.get("score", 0)),
                        "category": str(parsed.get("category", "other")),
                        "feedback": str(parsed.get("feedback", "")),
                    }
            except Exception as e:
                if attempt == 2:
                    print(f"  error on {url}: {e}")
                await asyncio.sleep(3)
    return None


# ── Export ────────────────────────────────────────────────────────────────────

def export_results() -> None:
    conn = connect()
    rows = conn.execute(
        "SELECT url, screenshot_path, ai_score, local_score, category, ai_feedback, title "
        "FROM sites WHERE status='analyzed' AND ai_score >= %s ORDER BY ai_score DESC",
        (MIN_SCORE,),
    ).fetchall()
    conn.close()

    if MIN_SCORE > 0:
        print(f"Exporting results with ai_score >= {MIN_SCORE:.0f}")

    results = [
        {
            "url": r[0],
            "screenshot": r[1],
            "ai_score": r[2],
            "local_score": r[3],
            "category": r[4],
            "ai_feedback": r[5],
            "title": r[6] or "",
        }
        for r in rows
    ]

    out_dir = Path("results")
    out_dir.mkdir(exist_ok=True)

    json_out = out_dir / "results.json"
    json_out.write_text(json.dumps(results, indent=2))

    csv_out = out_dir / "results.csv"
    with open(csv_out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["url", "title", "ai_score", "local_score", "category", "ai_feedback", "screenshot"]
        )
        writer.writeheader()
        writer.writerows(results)

    print(f"\nExported {len(results)} results → {json_out}  |  {csv_out}")


# ── Main ──────────────────────────────────────────────────────────────────────

def progress(done: int, total: int, width: int = 30) -> str:
    pct = done / total if total else 0
    filled = int(width * pct)
    bar = "█" * filled + "░" * (width - filled)
    return f"[{bar}] {done}/{total} ({pct:.0%})"


def run_derived_ai() -> None:
    """Compute ai_score from the local metrics (no Vision API calls).
    No --all: only rows with ai_score IS NULL are filled, so a run scores
    exactly what's unscored instead of rescoring the whole table each time.
    """
    import subprocess
    subprocess.run(
        [sys.executable, str(Path(__file__).parent / "synthesize_ai_scores.py"),
         "--mark-analyzed", "--as-ai"],
        check=False,
    )


async def run_ai_scoring() -> None:
    if AI_SCORING_MODE == "derived":
        run_derived_ai()
        return

    if not GEMINI_API_KEY and not GEMINI_MOCK:
        print("[ai] skipped — GEMINI_API_KEY not set")
        return

    sites = get_unanalyzed()
    if not sites:
        print("[ai] no screenshots waiting for analysis")
        return

    total = len(sites)
    print(f"[ai] analyzing {total} screenshot(s)  model={GEMINI_MODEL}  concurrency={CONCURRENCY}")
    sem = asyncio.Semaphore(CONCURRENCY)
    done = 0

    async with aiohttp.ClientSession() as session:
        batch_size = CONCURRENCY * 3
        for i in range(0, total, batch_size):
            batch = sites[i : i + batch_size]

            tasks = [
                analyze_one(session, sem, row[0], row[1], row[2]) for row in batch
            ]
            results = [r for r in await asyncio.gather(*tasks) if r]
            if results:
                save_batch(results)

            done += len(batch)
            if sys.stdout.isatty():
                # interactive terminal: live redraw bar
                sys.stdout.write(f"\r{progress(done, total)}")
                sys.stdout.flush()
            else:
                # piped (e.g. admin log): plain periodic line, no ░ redraw bar
                print(f"[ai] {done}/{total}")

            if i + batch_size < total:
                await asyncio.sleep(BATCH_DELAY)

    if sys.stdout.isatty():
        print()  # newline after progress bar


async def main() -> None:
    export_only = "--export-only" in sys.argv
    local_only  = "--local-only"  in sys.argv
    ai_only     = "--ai-only"     in sys.argv

    if export_only:
        export_results()
        return

    if not ai_only:
        run_local_scoring()
    if not local_only:
        await run_ai_scoring()
        export_results()


if __name__ == "__main__":
    asyncio.run(main())
