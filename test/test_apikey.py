#!/usr/bin/env python3
"""
Verify the Gemini API key and list available models.
No image sent — just a text ping.

  python test/test_apikey.py
"""
import asyncio
import os
import sys
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

API_KEY = os.getenv("GEMINI_API_KEY", "")


async def main() -> None:
    if not API_KEY or API_KEY == "your_gemini_api_key_here":
        print("FAIL — GEMINI_API_KEY not set in .env")
        sys.exit(1)

    print(f"Key prefix : {API_KEY[:8]}…\n")

    async with aiohttp.ClientSession() as session:
        # 1. List available models
        list_url = f"https://generativelanguage.googleapis.com/v1beta/models?key={API_KEY}"
        async with session.get(list_url, timeout=aiohttp.ClientTimeout(total=15)) as r:
            data = await r.json(content_type=None)
            if "error" in data:
                code = data["error"].get("code")
                msg  = data["error"].get("message")
                print(f"API error {code}: {msg}")
                print("\nCommon fixes:")
                print("  - Key copied incorrectly (spaces, quotes)")
                print("  - Gemini API not enabled → https://aistudio.google.com/apikey")
                print("  - Key restricted to wrong APIs in Cloud Console")
                sys.exit(1)

            models = [m["name"] for m in data.get("models", []) if "generateContent" in m.get("supportedGenerationMethods", [])]
            print("Available generateContent models:")
            for m in models:
                print(f"  {m}")

        # 2. Probe candidate models until one responds without 429
        candidates = [
            "gemini-2.0-flash-lite",
            "gemini-2.0-flash",
            "gemini-2.5-flash",
            "gemini-flash-latest",
            "gemini-flash-lite-latest",
        ]
        ping = {"contents": [{"parts": [{"text": "Reply with just the word: ok"}]}]}
        print("\nProbing models for free-tier access…")
        working = None
        for model in candidates:
            gen_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}"
            async with session.post(gen_url, json=ping, timeout=aiohttp.ClientTimeout(total=20)) as r:
                data = await r.json(content_type=None)
                if r.status == 200 and "candidates" in data:
                    reply = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                    print(f"  ✓  {model}  →  \"{reply}\"")
                    if not working:
                        working = model
                elif r.status == 429 and "limit: 0" in str(data):
                    print(f"  ✗  {model}  →  no free quota (limit: 0)")
                elif r.status == 429:
                    print(f"  ~  {model}  →  rate-limited (has quota but busy)")
                else:
                    code = data.get("error", {}).get("code", r.status)
                    print(f"  ✗  {model}  →  {code}")

        print()
        if working:
            print(f"Set in your .env:  GEMINI_MODEL={working}")
        else:
            print("No free-tier model found. Options:")
            print("  1. Enable billing at https://console.cloud.google.com/billing")
            print("     (pay-per-use, ~$0.075 per 1M tokens for flash)")
            print("  2. Create a new API key at https://aistudio.google.com/apikey")


asyncio.run(main())
