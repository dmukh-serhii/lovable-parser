#!/usr/bin/env python3
"""
Alternative domain fetcher using the Wayback Machine (archive.org) CDX API.

Independent from CommonCrawl — separate crawler, separate index.
Free, no API key, same CDX query format.

  python scripts/fetch_domains_wayback.py
"""
import asyncio
import json
import re
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from dotenv import load_dotenv

load_dotenv()

CDX_URL = "https://web.archive.org/cdx/search/cdx"
CONCURRENCY = 10


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


async def get_page_count(session: aiohttp.ClientSession) -> int:
    params = {
        "url": "*.lovable.app",
        "output": "json",
        "showNumPages": "true",
        "fl": "original",
        "collapse": "urlkey",
    }
    async with session.get(CDX_URL, params=params, timeout=aiohttp.ClientTimeout(total=30)) as r:
        text = (await r.text()).strip()
        if text.startswith("<"):
            raise RuntimeError(f"Got HTML — Wayback CDX may be down (HTTP {r.status})")
        return int(text)


async def fetch_page(
    session: aiohttp.ClientSession, page: int, sem: asyncio.Semaphore
) -> set[str]:
    results: set[str] = set()
    params = {
        "url": "*.lovable.app",
        "output": "json",
        "fl": "original",
        "collapse": "urlkey",
        "page": str(page),
    }
    async with sem:
        for attempt in range(3):
            try:
                async with session.get(
                    CDX_URL, params=params, timeout=aiohttp.ClientTimeout(total=60)
                ) as r:
                    if r.status in (429, 503):
                        await asyncio.sleep(10 * (attempt + 1))
                        continue
                    if r.status != 200:
                        break
                    data = await r.json(content_type=None)
                    # First row is the header ["original"]
                    for row in data[1:]:
                        if row:
                            normed = normalize(row[0])
                            if normed:
                                results.add(normed)
                    break
            except Exception as e:
                if attempt == 2:
                    print(f"  page {page} failed: {e}")
                await asyncio.sleep(3)
    return results


async def main() -> None:
    Path("data").mkdir(exist_ok=True)

    async with aiohttp.ClientSession() as session:
        print("Getting page count from Wayback Machine CDX…")
        try:
            pages = await get_page_count(session)
        except Exception as e:
            print(f"Failed: {e}")
            return
        print(f"Total pages: {pages}")

        sem = asyncio.Semaphore(CONCURRENCY)
        tasks = [fetch_page(session, i, sem) for i in range(pages)]

        all_domains: set[str] = set()
        done = 0
        for coro in asyncio.as_completed(tasks):
            all_domains |= await coro
            done += 1
            if done % 10 == 0 or done == pages:
                print(f"  {done}/{pages} pages  |  {len(all_domains)} domains")

    out = Path("data/domains.txt")
    if out.exists():
        existing = set(out.read_text().splitlines())
        before = len(existing)
        existing |= all_domains
        out.write_text("\n".join(sorted(existing)))
        print(f"\nMerged: {before} → {len(existing)} total domains → {out}")
    else:
        out.write_text("\n".join(sorted(all_domains)))
        print(f"\nSaved {len(all_domains)} domains → {out}")


if __name__ == "__main__":
    asyncio.run(main())
