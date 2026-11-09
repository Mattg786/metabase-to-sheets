#!/usr/bin/env bash
# Read waitlist count and signup list from the live Worker.
# Needs ~/.config/mts/waitlist_admin (chmod 600). Never prints the secret alone.
set -euo pipefail
TOKEN_FILE="${WAITLIST_ADMIN_TOKEN_FILE:-$HOME/.config/mts/waitlist_admin}"
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Missing $TOKEN_FILE" >&2
  exit 1
fi
TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"
BASE_URL="${MTS_BASE_URL:-https://metabase-to-sheets.matthew-k-galea.workers.dev}"
curl -sS -H "X-Waitlist-Admin: $TOKEN" "$BASE_URL/api/waitlist/stats"
echo
