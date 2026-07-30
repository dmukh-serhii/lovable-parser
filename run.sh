#!/usr/bin/env bash
# Full pipeline: fetch → crawl → analyze
# Usage: ./run.sh [fetch|crawl|analyze]   (default: all three)

set -euo pipefail
STEP=${1:-all}

fetch() {
  echo -e "\n\033[36m[1/3] Fetching domains from CommonCrawl…\033[0m"
  python scripts/fetch_domains.py
}

crawl() {
  echo -e "\n\033[36m[2/3] Crawling + screenshots…\033[0m"
  node crawler/index.js
}

analyze() {
  echo -e "\n\033[36m[3/3] Gemini Vision analysis…\033[0m"
  python scripts/analyze.py
}

case "$STEP" in
  fetch)   fetch ;;
  crawl)   crawl ;;
  analyze) analyze ;;
  all)     fetch && crawl && analyze && echo -e "\n\033[32mDone → results/results.json\033[0m" ;;
  *)       echo "Usage: $0 [fetch|crawl|analyze|all]"; exit 1 ;;
esac
