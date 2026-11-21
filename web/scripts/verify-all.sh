#!/usr/bin/env bash
# Full verification suite. Needs the dev server (npm run dev) on 127.0.0.1:5190, or BASE=... for preview.
# Exit code: 0 only when every step passed; otherwise 1. A per-step PASS/FAIL table is printed at the end.
# Each step's full output is kept in $OUT/<n>-<name>.log; a failed step also prints its FAIL/ERROR lines.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-/tmp/axion-verify}"; mkdir -p "$OUT"
names=(); codes=(); i=0
# step <title> <tail-lines> <command...>: runs the command, shows the last N lines, records its exit code
step() {
  local title=$1 n=$2; shift 2
  i=$((i + 1)); local log="$OUT/$(printf '%02d' "$i")-${title//[^A-Za-z0-9]/_}.log"
  echo "== $title"
  "$@" > "$log" 2>&1; local rc=$?
  tail -n "$n" "$log"
  if [ "$rc" -ne 0 ]; then
    echo "!! FAILED: $title (exit $rc), failing lines (full log: $log):"
    grep -E 'FAIL|BAD|MISSING|ERROR|PAGEERROR|PLACEHOLDER|EMPTY|error TS|Error:' "$log" | head -40 || true
  fi
  names+=("$title"); codes+=("$rc")
}
build() { npm run -s build > "$OUT/build.log" 2>&1; local rc=$?; tail -1 "$OUT/build.log"; return $rc; }
step "typecheck + build"       1  build
step "route×tab crawl"         2  node scripts/crawl.mjs "$OUT/crawl" dark luminous
step "deep crawl"              2  node scripts/crawl-deep.mjs
step "flows"                   24 node scripts/flows.mjs
step "auth flow (u1)"          19 node scripts/auth-flow.mjs
step "u1 flows"                9  node scripts/u1-flows.mjs
step "dialog smoke"            1  node scripts/dialog-smoke.mjs
step "dialog ids"              2  node scripts/check-dialogs.mjs
step "help keys"               1  node scripts/check-help.mjs
step "dev-server file guard"   1  node scripts/fs-guard.mjs
echo
echo "== summary"
fail=0
for k in "${!names[@]}"; do
  if [ "${codes[$k]}" -eq 0 ]; then s=PASS; else s="FAIL (exit ${codes[$k]})"; fail=$((fail + 1)); fi
  printf '  %-26s %s\n' "${names[$k]}" "$s"
done
if [ "$fail" -eq 0 ]; then echo "verify-all: ALL ${#names[@]} STEPS PASSED"; exit 0; fi
echo "verify-all: $fail of ${#names[@]} STEPS FAILED"; exit 1
