#!/usr/bin/env python3
"""
Alternative domain fetcher using Certificate Transparency logs (crt.sh).

Every lovable.app subdomain gets a TLS cert automatically, so crt.sh has
near-complete coverage. No API key, no pagination, single request.

  python scripts/fetch_domains_crtsh.py
"""
import asyncio
import json
import re
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

load_dotenv()

CRTSH_URL = "https://crt.sh/?q=%.lovable.app&output=json"


def normalize(name: str) -> str | None:
    name = name.strip().lower()
    # skip wildcards
    if name.startswith("*"):
        return None
    if name.endswith(".lovable.app") and name != "lovable.app":
        slug = name[: -len(".lovable.app")]
        if re.fullmatch(r"[a-z0-9][a-z0-9\-]*", slug):
            return f"https://{name}"
    return None


async def fetch() -> set[str]:
    print("Querying crt.sh for *.lovable.app certificates…")
    async with aiohttp.ClientSession() as session:
        async with session.get(
            CRTSH_URL,
            timeout=aiohttp.ClientTimeout(total=60),
            headers={"Accept": "application/json"},
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"crt.sh returned HTTP {r.status}")
            data = await r.json(content_type=None)

    domains: set[str] = set()
    for entry in data:
        # name_value can contain newline-separated names
        for raw in entry.get("name_value", "").splitlines():
            normed = normalize(raw)
            if normed:
                domains.add(normed)
    return domains


async def main() -> None:
    Path("data").mkdir(exist_ok=True)

    domains = await fetch()
    print(f"Found {len(domains)} unique domains")

    out = Path("data/domains.txt")

    # Merge with existing domains.txt if it already has entries
    if out.exists():
        existing = set(out.read_text().splitlines())
        before = len(existing)
        existing |= domains
        out.write_text("\n".join(sorted(existing)))
        print(f"Merged with existing file: {before} → {len(existing)} total")
    else:
        out.write_text("\n".join(sorted(domains)))
        print(f"Saved → {out}")


if __name__ == "__main__":
    asyncio.run(main())
