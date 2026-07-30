#!/usr/bin/env python3
"""
Send newly crawled lovable.app sites to a Telegram group.

python3 scripts/notify.py           # send all unnotified, mark as sent
python3 scripts/notify.py --test    # send up to 3, don't mark as sent
python3 scripts/notify.py --reset   # clear notified_at so all sites re-queue
"""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).parent))
from db import connect  # noqa: E402

BOT_TOKEN   = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID     = os.environ["TELEGRAM_CHAT_ID"]
BASE_URL    = os.getenv("SCREENSHOT_BASE_URL", "").rstrip("/")
TG          = f"https://api.telegram.org/bot{BOT_TOKEN}"
CONCURRENCY = int(os.getenv("TELEGRAM_CONCURRENCY", "3"))


# ── DB helpers ────────────────────────────────────────────────────────────────

def today_ts() -> int:
    dt = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(dt.timestamp())


def get_stats() -> dict:
    ts = today_ts()
    conn = connect()

    def q(sql, *args):
        return conn.execute(sql, args).fetchone()[0]

    stats = {
        "total":      q("SELECT COUNT(*) FROM sites"),
        "done_total": q("SELECT COUNT(*) FROM sites WHERE status IN ('done','analyzed')"),
        "done_today": q("SELECT COUNT(*) FROM sites WHERE status IN ('done','analyzed') AND crawled_at >= %s", ts),
        "nf_total":   q("SELECT COUNT(*) FROM sites WHERE status='not_found'"),
        "nf_today":   q("SELECT COUNT(*) FROM sites WHERE status='not_found' AND crawled_at >= %s", ts),
        "fail_total": q("SELECT COUNT(*) FROM sites WHERE status='failed'"),
        "fail_today": q("SELECT COUNT(*) FROM sites WHERE status='failed' AND crawled_at >= %s", ts),
        "unnotified": q("SELECT COUNT(*) FROM sites WHERE status IN ('done','analyzed') AND notified_at IS NULL"),
    }
    conn.close()
    return stats


def get_unnotified(limit: int = 0) -> list[dict]:
    conn = connect()
    sql = (
        "SELECT id, url, title, screenshot_path FROM sites "
        "WHERE status IN ('done','analyzed') AND notified_at IS NULL "
        "ORDER BY crawled_at ASC"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = conn.execute(sql).fetchall()
    conn.close()
    return [{"id": r[0], "url": r[1], "title": r[2], "screenshot_path": r[3]} for r in rows]


def mark_notified(ids: list[int]) -> None:
    conn = connect()
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE sites SET notified_at=EXTRACT(EPOCH FROM now())::BIGINT WHERE id=%s",
            [(i,) for i in ids],
        )
    conn.commit()
    conn.close()


def reset_notified() -> int:
    conn = connect()
    cur = conn.execute("UPDATE sites SET notified_at=NULL WHERE status IN ('done','analyzed')")
    n = cur.rowcount
    conn.commit()
    conn.close()
    return n


# ── Telegram helpers ──────────────────────────────────────────────────────────

async def send_message(session: aiohttp.ClientSession, text: str) -> None:
    async with session.post(f"{TG}/sendMessage", json={
        "chat_id":                  CHAT_ID,
        "text":                     text,
        "parse_mode":               "HTML",
        "disable_web_page_preview": True,
    }, timeout=aiohttp.ClientTimeout(total=15)) as r:
        if r.status != 200:
            body = await r.json()
            print(f"  Telegram error: {body.get('description', r.status)}")


async def send_csv(session: aiohttp.ClientSession, sites: list[dict], today: str) -> None:
    import csv, io
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["url", "title", "screenshot_url"])
    writer.writeheader()
    for s in sites:
        img = Path(s["screenshot_path"]) if s["screenshot_path"] else None
        screenshot_url = f"{BASE_URL}/screenshots/{img.name}" if (BASE_URL and img) else ""
        writer.writerow({"url": s["url"], "title": s["title"] or "", "screenshot_url": screenshot_url})

    data = aiohttp.FormData()
    data.add_field("chat_id",  CHAT_ID)
    data.add_field("caption",  f"New sites — {today}")
    data.add_field("document", buf.getvalue().encode(), filename=f"new-sites-{today}.csv",
                   content_type="text/csv")
    async with session.post(f"{TG}/sendDocument", data=data,
                            timeout=aiohttp.ClientTimeout(total=30)) as r:
        if r.status != 200:
            body = await r.json()
            print(f"  CSV send error: {body.get('description', r.status)}")


def format_site(site: dict) -> str:
    slug  = site["url"].replace("https://", "").replace(".lovable.app", "")
    title = site["title"] or slug
    img   = Path(site["screenshot_path"]) if site["screenshot_path"] else None
    screenshot_url = f"{BASE_URL}/screenshots/{img.name}" if (BASE_URL and img) else ""
    text = f"<b>{title}</b>\n{site['url']}"
    if screenshot_url:
        text += f"\nScreenshot: {screenshot_url}"
    return text


async def send_site(session: aiohttp.ClientSession, site: dict, dry_run: bool = False) -> None:
    slug  = site["url"].replace("https://", "").replace(".lovable.app", "")
    img   = Path(site["screenshot_path"]) if site["screenshot_path"] else None
    text  = format_site(site)

    for attempt in range(4):
        try:
            if img and img.exists():
                data = aiohttp.FormData()
                data.add_field("chat_id",    CHAT_ID)
                data.add_field("caption",    text)
                data.add_field("parse_mode", "HTML")
                data.add_field("photo", img.read_bytes(), filename=img.name, content_type="image/png")
                async with session.post(f"{TG}/sendPhoto", data=data,
                                        timeout=aiohttp.ClientTimeout(total=30)) as r:
                    if r.status == 429:
                        body = await r.json()
                        wait = body.get("parameters", {}).get("retry_after", 15)
                        print(f"  [{slug}] rate limited — waiting {wait}s…")
                        await asyncio.sleep(wait)
                        continue
                    if r.status != 200:
                        body = await r.json()
                        print(f"  [{slug}] {body.get('description', r.status)}")
            else:
                await send_message(session, text)
            if not dry_run:
                mark_notified([site["id"]])
            break
        except Exception as e:
            if attempt == 3:
                print(f"  [{slug}] error: {e}")
            await asyncio.sleep(2)

    await asyncio.sleep(3)


# ── Main ──────────────────────────────────────────────────────────────────────

async def main() -> None:
    test_mode  = "--test"  in sys.argv
    reset_mode = "--reset" in sys.argv

    if reset_mode:
        n = reset_notified()
        print(f"Reset {n} sites — they will be re-sent on next run.")
        return

    stats = get_stats()
    sites = get_unnotified(limit=3 if test_mode else 0)

    if not sites:
        print(f"Nothing to notify ({stats['done_total']} sites already sent).")
        return

    today  = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    header = (
        f"📊 <b>Daily Report — {today}</b>\n\n"
        f"Total discovered: {stats['total']:,}\n"
        f"✅ Crawled: {stats['done_total']:,} (+{stats['done_today']} today)\n"
        f"❌ Not found: {stats['nf_total']:,} (+{stats['nf_today']} today)\n"
        f"⚠️ Failed: {stats['fail_total']:,} (+{stats['fail_today']} today)\n\n"
        f"📬 Sending {len(sites)} new site(s)"
        + (" [TEST]" if test_mode else "")
    )

    async with aiohttp.ClientSession() as session:
        await send_message(session, header)
        print(f"Stats sent. Sending {len(sites)} site(s)...")
        for i, site in enumerate(sites):
            await send_site(session, site, dry_run=test_mode)
            if (i + 1) % 20 == 0 and i + 1 < len(sites):
                print(f"  [{i+1}/{len(sites)}] batch pause 5s…")
                await asyncio.sleep(5)
        await send_csv(session, sites, today)
        print("CSV sent.")

    print(f"Done — {len(sites)} site(s) sent" + (" [test mode — not marked]" if test_mode else " and marked as notified") + ".")


if __name__ == "__main__":
    asyncio.run(main())
