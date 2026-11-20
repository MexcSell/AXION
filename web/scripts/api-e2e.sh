#!/usr/bin/env bash
# Runs the api-mode browser checks against a throw-away stack:
#   API 127.0.0.1:5192 on axion_e2e (reset on start) + Vite 127.0.0.1:5193 proxying /api to it.
# Usage: ./scripts/api-e2e.sh [script.mjs ...]   (default: api-auth-flow.mjs api-flows.mjs)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-/tmp/axion-api-e2e}"; mkdir -p "$OUT"
( cd ../server && exec npm run -s e2e:serve ) > "$OUT/api.log" 2>&1 &
API=$!
AXION_API=http://127.0.0.1:5192 npx vite --host 127.0.0.1 --port 5193 --strictPort > "$OUT/vite.log" 2>&1 &
VITE=$!
trap 'kill $API $VITE 2>/dev/null || true; wait 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf http://127.0.0.1:5192/api/v1/health >/dev/null && curl -sf http://127.0.0.1:5193/ >/dev/null && break; sleep 0.5; done
export BASE=http://127.0.0.1:5193 API_PID=$API
scripts=("$@"); [ ${#scripts[@]} -eq 0 ] && scripts=(api-auth-flow.mjs api-flows.mjs)
rc=0
for s in "${scripts[@]}"; do [ -f "scripts/$s" ] || continue; echo "== $s"; node "scripts/$s" || rc=1; done
exit $rc
