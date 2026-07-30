#!/usr/bin/env python3
"""
Smoke-test the Gemini Vision integration — makes exactly 1 API call.

Picks the first unanalyzed screenshot from the DB (run test_crawl.js first),
calls Gemini, prints the structured result, and writes it back to the DB.

  python test/test_analyze.py
"""
import asyncio
import base64
import json
import os
import re
import sys
from pathlib import Path

import aiohttp

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from analyze import get_unanalyzed, save_batch, GEMINI_URL, GEMINI_MODEL, PROMPT


async def analyze_once(session: aiohttp.ClientSession, site_id: int, url: str, screenshot_path: str) -> dict | None:
    """Single-attempt call — no retries, no waiting. Fails fast for test clarity."""
    img_b64 = base64.b64encode(Path(screenshot_path).read_bytes()).decode()
    payload = {
        "contents": [{"parts": [
            {"text": PROMPT},
            {"inline_data": {"mime_type": "image/png", "data": img_b64}},
        ]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1024},
    }

    async with session.post(GEMINI_URL, json=payload, timeout=aiohttp.ClientTimeout(total=45)) as r:
        data = await r.json(content_type=None)

        if r.status == 429:
            msg = data.get("error", {}).get("message", str(data))
            print(f"\n[test:analyze] RATE LIMITED — {msg}")
            print("\n  Fixes:")
            print("  1. Wait 1 minute and retry (free tier: 15 req/min)")
            print("  2. Check daily quota at https://aistudio.google.com/")
            print(f"  3. Verify model availability: GEMINI_MODEL={GEMINI_MODEL}")
            return None

        if r.status != 200 or "error" in data:
            code = data.get("error", {}).get("code", r.status)
            msg  = data.get("error", {}).get("message", str(data))
            print(f"\n[test:analyze] API ERROR {code}: {msg}")
            return None

        if "candidates" not in data:
            reason = data.get("promptFeedback", {}).get("blockReason", "unknown")
            print(f"\n[test:analyze] blocked by Gemini: {reason}")
            return None

        text = data["candidates"][0]["content"]["parts"][0]["text"]
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            print(f"\n[test:analyze] could not parse JSON from response:\n{text}")
            return None

        parsed = json.loads(match.group())
        return {
            "id": site_id,
            "url": url,
            "score": float(parsed.get("score", 0)),
            "category": str(parsed.get("category", "other")),
            "feedback": str(parsed.get("feedback", "")),
        }


async def main() -> None:
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key or api_key == "your_gemini_api_key_here":
        print("[test:analyze] FAIL — set GEMINI_API_KEY in .env first")
        sys.exit(1)

    rows = get_unanalyzed()
    if not rows:
        print("[test:analyze] no unanalyzed screenshots found")
        print("  run:  node test/test_crawl.js  first")
        sys.exit(1)

    site_id, url, screenshot_path = rows[0]
    print(f"[test:analyze] model      : {GEMINI_MODEL}")
    print(f"[test:analyze] target     : {url}")
    print(f"[test:analyze] screenshot : {screenshot_path}")

    async with aiohttp.ClientSession() as session:
        result = await analyze_once(session, site_id, url, screenshot_path)

    if not result:
        sys.exit(1)

    print("\n[test:analyze] PASS")
    print(f"  score    : {result['score']}")
    print(f"  category : {result['category']}")
    print(f"  feedback : {result['feedback']}")

    save_batch([result])
    print("\n  saved to DB")


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
    asyncio.run(main())
