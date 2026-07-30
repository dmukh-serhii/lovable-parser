# ─────────────────────────────────────────────────────────────────
# run.ps1  —  Full pipeline: fetch → crawl → analyze
#
# Usage:
#   .\run.ps1              # all three steps
#   .\run.ps1 -Step fetch  # CommonCrawl (primary)
#   .\run.ps1 -Step fetch-crt  # crt.sh fallback (use when CommonCrawl is down)
#   .\run.ps1 -Step crawl  # only crawl (needs data/domains.txt)
#   .\run.ps1 -Step analyze # only analyze screenshots
# ─────────────────────────────────────────────────────────────────
param(
    [ValidateSet("all","fetch","fetch-crt","fetch-wayback","crawl","analyze")]
    [string]$Step = "all"
)

$ErrorActionPreference = "Stop"

function Step-Fetch {
    Write-Host "`n[1/3] Fetching lovable.app domains from CommonCrawl..." -ForegroundColor Cyan
    python scripts/fetch_domains.py
    if ($LASTEXITCODE -ne 0) { throw "fetch_domains.py failed" }
}

function Step-FetchCrt {
    Write-Host "`n[1/3] Fetching lovable.app domains from crt.sh (fallback)..." -ForegroundColor Cyan
    python scripts/fetch_domains_crtsh.py
    if ($LASTEXITCODE -ne 0) { throw "fetch_domains_crtsh.py failed" }
}

function Step-FetchWayback {
    Write-Host "`n[1/3] Fetching lovable.app domains from Wayback Machine..." -ForegroundColor Cyan
    python scripts/fetch_domains_wayback.py
    if ($LASTEXITCODE -ne 0) { throw "fetch_domains_wayback.py failed" }
}

function Step-Crawl {
    Write-Host "`n[2/3] Crawling sites + taking screenshots..." -ForegroundColor Cyan
    node crawler/index.js
    if ($LASTEXITCODE -ne 0) { throw "crawler failed" }
}

function Step-Analyze {
    Write-Host "`n[3/3] Analyzing screenshots with Gemini Vision..." -ForegroundColor Cyan
    python scripts/analyze.py
    if ($LASTEXITCODE -ne 0) { throw "analyze.py failed" }
}

switch ($Step) {
    "fetch"          { Step-Fetch }
    "fetch-crt"      { Step-FetchCrt }
    "fetch-wayback"  { Step-FetchWayback }
    "crawl"     { Step-Crawl }
    "analyze"   { Step-Analyze }
    "all" {
        Step-Fetch
        Step-Crawl
        Step-Analyze
        Write-Host "`nDone. Results → results/results.json" -ForegroundColor Green
    }
}
