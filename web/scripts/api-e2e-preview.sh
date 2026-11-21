#!/usr/bin/env bash
# Cycle 14: the api-mode browser checks against the PRODUCTION build served by `vite preview`, which sends the strict
# Content-Security-Policy from security-headers.ts. Same stack as api-e2e.sh otherwise:
#   API on E2E_API_PORT (default 5192, axion_e2e*, reset on start, DEMO seed on) + `vite preview` on E2E_WEB_PORT
#   (default 5193) proxying /api to it.
# Usage: ./scripts/api-e2e-preview.sh [script.mjs | "full command" ...]   (default: api-c14.mjs api-auth-flow.mjs api-flows.mjs)
# The build runs once (SKIP_BUILD=1 reuses dist/).
set -euo pipefail
cd "$(dirname "$0")/.."
AP="${E2E_API_PORT:-5192}"; WP="${E2E_WEB_PORT:-5193}"
OUT="${OUT:-/tmp/axion-api-e2e-preview-$AP}"; mkdir -p "$OUT"
for port in "$AP" "$WP"; do
  if ss -ltn "sport = :$port" | grep -q LISTEN; then echo "port $port is busy (a stale e2e run?): stop it first" >&2; exit 2; fi
done
if [ -z "${SKIP_BUILD:-}" ]; then node node_modules/vite/bin/vite.js build --logLevel warn > "$OUT/build.log" 2>&1 || { cat "$OUT/build.log"; exit 1; }; fi
API=""; WEB=""
stop() { [ -n "$API$WEB" ] && kill -- ${API:+-$API} ${WEB:+-$WEB} 2>/dev/null || true; wait 2>/dev/null || true; API=""; WEB=""
  for i in $(seq 1 40); do ss -ltn | grep -qE ":($AP|$WP) " || break; sleep 0.25; done; }
start() {
  setsid env E2E_PORT="$AP" bash -c 'cd ../server && exec node --env-file=.env --import tsx src/cli/e2e-serve.ts' >> "$OUT/api.log" 2>&1 &
  API=$!
  setsid env AXION_API=http://127.0.0.1:$AP node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port "$WP" --strictPort >> "$OUT/preview.log" 2>&1 &
  WEB=$!
  for i in $(seq 1 80); do curl -sf http://127.0.0.1:$AP/api/v1/health >/dev/null && curl -sf http://127.0.0.1:$WP/ >/dev/null && break; sleep 0.5; done
  # refuse to run the checks when the page is not served with the CSP: then they would prove nothing
  curl -sI http://127.0.0.1:$WP/ | grep -qi "^content-security-policy: .*script-src 'self'" || { echo "vite preview does not send the CSP" >&2; stop; exit 1; }
}
trap stop EXIT
: > "$OUT/api.log"; : > "$OUT/preview.log"
export BASE=http://127.0.0.1:$WP
scripts=("$@"); [ ${#scripts[@]} -eq 0 ] && scripts=(api-c14.mjs api-auth-flow.mjs api-flows.mjs)
rc=0
for s in "${scripts[@]}"; do
  echo "== $s (vite preview + CSP)"
  start
  if [[ "$s" == *" "* ]]; then API_PID=$API bash -c "$s" || rc=1
  elif [ -f "scripts/$s" ]; then API_PID=$API node "scripts/$s" || rc=1
  else echo "no such script: $s"; rc=1; fi
  stop
done
exit $rc
