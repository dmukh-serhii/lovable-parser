# Full pipeline smoke test (Windows)
# Usage: npm run test:pipeline

$ErrorActionPreference = "Stop"

function Step($n, $msg) { Write-Host "`n[$n/5] $msg" -ForegroundColor Cyan }
function Ok($msg)        { Write-Host "  OK  $msg"   -ForegroundColor Green }
function Fail($msg)      { Write-Host "  FAIL $msg"  -ForegroundColor Red; exit 1 }

Write-Host "`n=== Pipeline smoke test ===" -ForegroundColor Yellow

# 1. Clean data
Step 1 "Cleaning data"
Remove-Item data\domains_*.txt -ErrorAction SilentlyContinue
Remove-Item data\crawler.db    -ErrorAction SilentlyContinue
Remove-Item data\screenshots\* -ErrorAction SilentlyContinue
Remove-Item results\*          -ErrorAction SilentlyContinue
Ok "data directory clean"

# 2. Fetch
Step 2 "Fetching domains (1 CC index, 15 limit)"
$env:CC_INDEX    = "CC-MAIN-2026-17"
$env:FETCH_LIMIT = "15"
python scripts/fetch_domains.py
if ($LASTEXITCODE -ne 0) { Fail "fetch_domains.py exited $LASTEXITCODE" }
Remove-Item Env:\CC_INDEX
Remove-Item Env:\FETCH_LIMIT
Ok "fetch done"

# 3. Crawl
Step 3 "Crawling 15 sites"
$env:CRAWL_CONCURRENCY = "3"
$env:CRAWL_LIMIT       = "15"
node crawler/index.js
if ($LASTEXITCODE -ne 0) { Fail "crawler exited $LASTEXITCODE" }
Remove-Item Env:\CRAWL_CONCURRENCY
Remove-Item Env:\CRAWL_LIMIT
Ok "crawl done"

# 4. Analyze (mocked)
Step 4 "Analyzing (mocked - no real Gemini calls)"
$env:GEMINI_MOCK = "true"
python scripts/analyze.py
if ($LASTEXITCODE -ne 0) { Fail "analyze.py exited $LASTEXITCODE" }
Remove-Item Env:\GEMINI_MOCK
Ok "analyze done"

# 5. Stats
Step 5 "Final stats"
node crawler/stats.js

Write-Host "`n=== Test passed ===" -ForegroundColor Green
