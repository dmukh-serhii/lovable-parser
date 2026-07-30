#!/usr/bin/env bash
# Full pipeline smoke test (Linux/Mac)
# Usage: npm run test:pipeline

set -e

step() { echo -e "\n[$1/5] $2"; }
ok()   { echo "  OK  $1"; }

echo "=== Pipeline smoke test ==="

# 1. Clean data
step 1 "Cleaning data"
rm -f data/domains_*.txt data/crawler.db
rm -f data/screenshots/* 2>/dev/null; rm -f results/* 2>/dev/null
ok "data directory clean"

# 2. Fetch
step 2 "Fetching domains (1 CC index, 15 limit)"
CC_INDEX=CC-MAIN-2026-17 FETCH_LIMIT=15 python3 scripts/fetch_domains.py
ok "fetch done"

# 3. Crawl
step 3 "Crawling 15 sites"
CRAWL_CONCURRENCY=3 CRAWL_LIMIT=15 node crawler/index.js
ok "crawl done"

# 4. Analyze (mocked)
step 4 "Analyzing (mocked - no real Gemini calls)"
GEMINI_MOCK=true python3 scripts/analyze.py
ok "analyze done"

# 5. Stats
step 5 "Final stats"
node crawler/stats.js

echo -e "\n=== Test passed ==="
