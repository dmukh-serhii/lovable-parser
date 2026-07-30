#!/usr/bin/env python3
"""
Part 2 of the R2 migration — upload the converted WebP screenshots to R2 and
record the object key in Neon.

Reads data/screenshots_webp/<domain>.webp (produced by prepare_screenshots.py)
and uploads each to R2 as  screenshots/<domain>.webp  with:
    Content-Type:  image/webp
    Cache-Control: public, max-age=31536000, immutable

- Concurrency-limited (~10), resumable: an object already present with a
  matching byte size is skipped (and its DB key backfilled); a row whose
  screenshot_key is already set is skipped without any R2 call.
- Transient failures are retried (boto3 standard retries); permanent failures
  are logged to data/r2_upload_failures.log.
- sites.screenshot_key is set ONLY after a verified successful upload.

Env (R2 S3-compatible API token — Cloudflare dashboard → R2 → Manage API tokens):
    R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET

    python scripts/upload_screenshots_r2.py             # upload missing
    python scripts/upload_screenshots_r2.py --force     # re-check/re-upload all
    python scripts/upload_screenshots_r2.py --dry-run
"""
import argparse
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))
from db import connect  # noqa: E402

WEBP_DIR = Path("data/screenshots_webp")
KEY_PREFIX = "screenshots"
FAIL_LOG = Path("data/r2_upload_failures.log")
CACHE_CONTROL = "public, max-age=31536000, immutable"


def domain_of(url: str) -> str:
    return (urlparse(url).hostname or url.split("//")[-1].split("/")[0]).lower()


def r2_client():
    import boto3
    from botocore.config import Config

    account = os.environ.get("R2_ACCOUNT_ID")
    access = os.environ.get("R2_ACCESS_KEY_ID")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY")
    if not all([account, access, secret]):
        sys.exit(
            "Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
            "R2_SECRET_ACCESS_KEY (and R2_BUCKET) in .env — create an R2 API "
            "token in the Cloudflare dashboard (R2 → Manage API tokens)."
        )
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(retries={"max_attempts": 4, "mode": "standard"},
                      max_pool_connections=32),
    )


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="re-check every object even if screenshot_key is set")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workers", type=int, default=10)
    args = ap.parse_args()

    bucket = os.environ.get("R2_BUCKET", "lovable-parser-screenshots")

    conn = connect()
    where = "screenshot_path IS NOT NULL"
    if not args.force:
        where += " AND screenshot_key IS NULL"
    rows = conn.execute(f"SELECT id, url FROM sites WHERE {where} ORDER BY id").fetchall()

    if not rows:
        print("Nothing to upload (all screenshotted rows already have screenshot_key).")
        conn.close()
        return

    client = None if args.dry_run else r2_client()
    from botocore.exceptions import ClientError

    print(f"{'[dry-run] ' if args.dry_run else ''}Uploading up to {len(rows)} WebP screenshot(s) "
          f"to r2://{bucket}/{KEY_PREFIX}/  (workers={args.workers})")

    lock = threading.Lock()
    counts = {"uploaded": 0, "skipped": 0, "missing": 0, "failed": 0}
    fail_lines: list[str] = []

    def head_size(key: str) -> int | None:
        try:
            return client.head_object(Bucket=bucket, Key=key)["ContentLength"]
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def work(site_id: int, url: str) -> tuple[int, str | None, str]:
        """Returns (id, key_or_None, status)."""
        domain = domain_of(url)
        local = WEBP_DIR / f"{domain}.webp"
        key = f"{KEY_PREFIX}/{domain}.webp"
        if not local.exists():
            return (site_id, None, "missing")
        size = local.stat().st_size
        if args.dry_run:
            return (site_id, key, "uploaded")
        try:
            remote = head_size(key)
            if remote == size:
                return (site_id, key, "skipped")  # already there, matching size
            client.upload_file(
                str(local), bucket, key,
                ExtraArgs={"ContentType": "image/webp", "CacheControl": CACHE_CONTROL},
            )
            # verify the object landed with the expected size before claiming success
            if head_size(key) != size:
                raise RuntimeError("post-upload size mismatch")
            return (site_id, key, "uploaded")
        except Exception as e:
            with lock:
                fail_lines.append(f"{domain}\t{key}\t{e}")
            return (site_id, None, "failed")

    pending_updates: list[tuple[str, int]] = []

    def flush(cur) -> None:
        if not pending_updates:
            return
        cur.executemany("UPDATE sites SET screenshot_key=%s WHERE id=%s", pending_updates)
        conn.commit()
        pending_updates.clear()

    done = 0
    with conn.cursor() as cur, ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(work, sid, url) for sid, url in rows]
        for fut in as_completed(futs):
            site_id, key, status = fut.result()
            counts[status] += 1
            # key is set on verified upload OR verified-existing (skipped)
            if key and status in ("uploaded", "skipped") and not args.dry_run:
                pending_updates.append((key, site_id))
            done += 1
            if len(pending_updates) >= 200:
                flush(cur)
            if done % 1000 == 0:
                print(f"  {done}/{len(rows)}  "
                      f"(up {counts['uploaded']} skip {counts['skipped']} fail {counts['failed']})")
        flush(cur)
    conn.close()

    if fail_lines and not args.dry_run:
        FAIL_LOG.parent.mkdir(parents=True, exist_ok=True)
        FAIL_LOG.write_text("\n".join(fail_lines), encoding="utf-8")

    # final bucket size (real, from R2 listing)
    bucket_bytes = 0
    bucket_objs = 0
    if not args.dry_run:
        token = None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": f"{KEY_PREFIX}/", "MaxKeys": 1000}
            if token:
                kwargs["ContinuationToken"] = token
            resp = client.list_objects_v2(**kwargs)
            for o in resp.get("Contents", []):
                bucket_bytes += o["Size"]
                bucket_objs += 1
            if not resp.get("IsTruncated"):
                break
            token = resp.get("NextContinuationToken")

    print("\n" + "=" * 56)
    print("PART 2 REPORT — R2 upload")
    print("=" * 56)
    print(f"  uploaded: {counts['uploaded']}   skipped(existing): {counts['skipped']}"
          f"   missing local: {counts['missing']}   failed: {counts['failed']}")
    if counts["failed"]:
        print(f"  ⚠ {counts['failed']} permanent failure(s) logged to {FAIL_LOG}")
    if not args.dry_run:
        print(f"  bucket now: {bucket_objs} objects, {human(bucket_bytes)} "
              f"under r2://{bucket}/{KEY_PREFIX}/")
        withkey = connect()
        n = withkey.execute("SELECT COUNT(*) FROM sites WHERE screenshot_key IS NOT NULL").fetchone()[0]
        withkey.close()
        print(f"  sites.screenshot_key set: {n}")


if __name__ == "__main__":
    main()
