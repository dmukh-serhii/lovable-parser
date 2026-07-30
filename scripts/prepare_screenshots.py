#!/usr/bin/env python3
"""
Part 1 of the R2 migration — convert local screenshots to WebP and report
projected R2 usage. No upload happens here.

- Reads each screenshotted site (id + url) from the DB, converts the local
  data/screenshots/<id>.png to WebP (quality 80, original resolution), and
  writes data/screenshots_webp/<domain>.webp  (domain = the unique hostname,
  matching the R2 key scheme screenshots/<domain>.webp).
- Idempotent/resumable: an existing .webp is left untouched.
- Prints a size report: originals vs WebP, compression ratio, projected R2
  usage vs the 10 GB free limit with a PASS/FAIL line, and the 20 largest
  WebP files.

    python scripts/prepare_screenshots.py
    python scripts/prepare_screenshots.py --quality 70 --max-width 1280
"""
import argparse
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from PIL import Image

load_dotenv()

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))
from db import connect  # noqa: E402

SRC_DIR = Path("data/screenshots")
OUT_DIR = Path("data/screenshots_webp")

GB = 1024 ** 3
FREE_LIMIT = 10 * GB
SAFETY_LIMIT = 9 * GB


def domain_of(url: str) -> str:
    return (urlparse(url).hostname or url.split("//")[-1].split("/")[0]).lower()


def convert_one(src: Path, out: Path, quality: int, max_width: int) -> tuple[str, int, int]:
    """Returns (status, original_bytes, webp_bytes). status: converted|skipped|missing|error."""
    if not src.exists():
        return ("missing", 0, 0)
    orig = src.stat().st_size
    if out.exists():
        return ("skipped", orig, out.stat().st_size)
    try:
        with Image.open(src) as im:
            im = im.convert("RGB")
            if max_width and im.width > max_width:
                h = round(im.height * max_width / im.width)
                im = im.resize((max_width, h), Image.LANCZOS)
            out.parent.mkdir(parents=True, exist_ok=True)
            im.save(out, "WEBP", quality=quality, method=4)
        return ("converted", orig, out.stat().st_size)
    except Exception as e:
        print(f"  error {src.name}: {e}")
        return ("error", orig, 0)


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} GB"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quality", type=int, default=80)
    ap.add_argument("--max-width", type=int, default=0, help="cap width in px (0 = keep original)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    conn = connect()
    rows = conn.execute(
        "SELECT id, url FROM sites WHERE screenshot_path IS NOT NULL ORDER BY id"
    ).fetchall()
    conn.close()

    if not rows:
        print("No screenshotted rows found.")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tasks = [(SRC_DIR / f"{sid}.png", OUT_DIR / f"{domain_of(url)}.webp") for sid, url in rows]

    print(f"Converting up to {len(tasks)} screenshots → WebP q{args.quality}"
          + (f" (max width {args.max_width}px)" if args.max_width else " (original resolution)"))

    counts = {"converted": 0, "skipped": 0, "missing": 0, "error": 0}
    total_orig = 0
    total_webp = 0
    sizes: list[tuple[int, str]] = []  # (webp_bytes, name)

    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(convert_one, src, out, args.quality, args.max_width): out
                for src, out in tasks}
        for fut in as_completed(futs):
            status, orig, webp = fut.result()
            counts[status] += 1
            total_orig += orig
            total_webp += webp
            if webp > 0:
                sizes.append((webp, futs[fut].name))
            done += 1
            if done % 2000 == 0:
                print(f"  {done}/{len(tasks)}")

    ratio = (total_orig / total_webp) if total_webp else 0
    processed = counts["converted"] + counts["skipped"]

    print("\n" + "=" * 60)
    print("PART 1 REPORT — WebP conversion")
    print("=" * 60)
    print(f"  converted: {counts['converted']}   skipped(existing): {counts['skipped']}"
          f"   missing files: {counts['missing']}   errors: {counts['error']}")
    print(f"  originals total:  {human(total_orig)}")
    print(f"  WebP total:       {human(total_webp)}   ({processed} files)")
    print(f"  compression:      {ratio:.2f}x smaller  "
          f"(WebP is {100 * total_webp / total_orig:.0f}% of original)" if total_orig else "")
    print()
    print(f"  projected R2 usage: {human(total_webp)}  of 10 GB free tier")
    pct = 100 * total_webp / FREE_LIMIT
    print(f"  = {pct:.1f}% of free limit")
    if total_webp < SAFETY_LIMIT:
        print(f"  PASS ✅  under the 9 GB safety margin")
    else:
        print(f"  FAIL ❌  exceeds the 9 GB safety margin — STOP and adjust "
              f"(quality 70, --max-width 1280, or exclude blank/failed shots)")

    print("\n── 20 largest WebP files ──")
    for size, name in sorted(sizes, reverse=True)[:20]:
        print(f"  {human(size):>10}  {name}")


if __name__ == "__main__":
    main()
