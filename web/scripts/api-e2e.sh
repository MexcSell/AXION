#!/usr/bin/env bash
# Runs the api-mode browser checks against a throw-away stack:
#   API 127.0.0.1:5192 on axion_e2e (reset on start, DEMO seed on) + Vite 127.0.0.1:5193 proxying /api to it.
# Usage: ./scripts/api-e2e.sh [script.mjs ...]   (default: api-auth-flow.mjs api-flows.mjs)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-/tmp/axion-api-e2e}"; mkdir -p "$OUT"
for port in 5192 5193; do
  if ss -ltn "sport = :$port" | grep -q LISTEN; then echo "port $port is busy (a stale e2e run?): stop it first" >&2; exit 2; fi
done
# each in its own process group, so cleanup also stops their children (npm/npx wrappers leave orphans otherwise)
API=""; VITE=""
stop() { [ -n "$API$VITE" ] && kill -- ${API:+-$API} ${VITE:+-$VITE} 2>/dev/null || true; wait 2>/dev/null || true; API=""; VITE=""
  for i in $(seq 1 40); do ss -ltn | grep -qE ":519[23] " || break; sleep 0.25; done; }
start() {
  setsid bash -c 'cd ../server && exec node --env-file=.env --import tsx src/cli/e2e-serve.ts' >> "$OUT/api.log" 2>&1 &
  API=$!
  setsid env AXION_API=http://127.0.0.1:5192 node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5193 --strictPort >> "$OUT/vite.log" 2>&1 &
  VITE=$!
  for i in $(seq 1 80); do curl -sf http://127.0.0.1:5192/api/v1/health >/dev/null && curl -sf http://127.0.0.1:5193/ >/dev/null && break; sleep 0.5; done
}
trap stop EXIT
: > "$OUT/api.log"; : > "$OUT/vite.log"
export BASE=http://127.0.0.1:5193
scripts=("$@"); [ ${#scripts[@]} -eq 0 ] && scripts=(api-auth-flow.mjs api-flows.mjs)
rc=0
for s in "${scripts[@]}"; do
  [ -f "scripts/$s" ] || continue
  echo "== $s"
  start  # a fresh stack per script: the e2e database is emptied on every API start
  API_PID=$API node "scripts/$s" || rc=1
  stop
done
exit $rc
