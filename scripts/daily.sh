#!/usr/bin/env bash
# Daily cron script — fetch latest CC index, crawl new sites, notify Telegram
#
# Cron example (runs at 9am UTC every day):
#   0 9 * * * /bin/bash /home/ubuntu/lovable-parser/scripts/daily.sh >> /home/ubuntu/lovable-parser/logs/daily.log 2>&1

set -e
cd "$(dirname "$0")/.."

source venv/bin/activate

mkdir -p logs

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting daily run..."

# Fetch from the latest CC index only (fast — 1 HTTP request)
python3 scripts/fetch_domains.py --cc-only --latest-only

# Crawl any new pending sites
node crawler/index.js

# Send new sites to Telegram
python3 scripts/notify.py

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done."
