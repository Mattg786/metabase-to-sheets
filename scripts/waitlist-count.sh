#!/usr/bin/env bash
# Print waitlist signup count from remote D1 (emails are never listed).
set -euo pipefail
cd "$(dirname "$0")/.."
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-a662f534164756d11b33bd10f2c924b5}"
npx wrangler@4.158.0 d1 execute metabase-to-sheets-waitlist --remote \
  --command="SELECT COUNT(*) AS signup_count FROM waitlist"
