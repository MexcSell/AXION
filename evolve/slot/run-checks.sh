#!/usr/bin/env bash
# Every check for one candidate, inside the checks container (evolve/docker/checks.Dockerfile), on an --internal network
# with a throw-away PostgreSQL. Run as the image's user (node) from WORKDIR /app: bash evolve/slot/run-checks.sh
#
# Environment (in):
#   TEST_DATABASE_URL  the throw-away axion_test database (server tests: one schema per test file)
#   E2E_DATABASE_URL   the throw-away axion_e2e database (browser checks; e2e-serve.ts empties it on every start)
#   GIT_DIR, GIT_WORK_TREE=/app (optional)  the repository's git dir mounted read-only, for the contract test that diffs
#                      against a base commit. The mounted index belongs to another checkout, so a private index of
#                      AXION_COMMIT (else HEAD) is built in /tmp; nothing is ever written into the mount.
#   PGUSER             the throw-away's role, used by the socket-URL test (migrate-start.test.ts), which connects to
#                      postgresql:///axion_test?host=/var/run/postgresql: mount the throw-away's socket dir (a shared volume)
#                      at /var/run/postgresql. Without the socket that test fails (connection refused/ENOENT is not a skip).
#   AXION_E2E_SCRIPTS  browser scripts for web/scripts/api-e2e.sh, space-separated (default: api-auth-flow.mjs; ruling R6:
#                      api-flows.mjs still asserts the DEMO missions retired in d637bc6c, so it is not in the default set)
#   CHECKS_OUT (default /out), VITEST_MAX_WORKERS (default 8)
# Out: $CHECKS_OUT/vitest.json, $CHECKS_OUT/summary.json { passed, failed, skipped, seconds, ok, steps }, $CHECKS_OUT/e2e/*.log
# Exit 0 only if every step passed. Every step runs even after a failure, so one run reports everything.
set -uo pipefail
cd "$(dirname "$0")/../.."
APP=$(pwd)
OUT="${CHECKS_OUT:-/out}"
mkdir -p "$OUT/e2e"
T0=$(date +%s)

# Docker sets no USER; the pg client falls back to it for a URL without a user (PGUSER wins when set)
export USER="${USER:-$(id -un 2>/dev/null || echo axion-checks)}"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is required}"
: "${E2E_DATABASE_URL:?E2E_DATABASE_URL is required}"
for u in "$TEST_DATABASE_URL" "$E2E_DATABASE_URL"; do
  # written unquoted into .env below: refuse anything the .env parser could cut or reinterpret
  case "$u" in *[[:space:]\"\'\#\$\`\\]*) echo "run-checks: a database URL contains a character .env cannot carry unquoted" >&2; exit 2 ;; esac
done

# test-only server/.env, only inside this container (no .env is ever in the image): the e2e server reads it with
# `node --env-file=.env`, vitest.config.ts loads it. Nothing else goes in.
( umask 077; printf 'DATABASE_URL=%s\nE2E_DATABASE_URL=%s\nTEST_DATABASE_URL=%s\n' "$E2E_DATABASE_URL" "$E2E_DATABASE_URL" "$TEST_DATABASE_URL" > "$APP/server/.env" )

if [ -n "${GIT_DIR:-}" ]; then
  export GIT_WORK_TREE="${GIT_WORK_TREE:-$APP}"
  export GIT_INDEX_FILE; GIT_INDEX_FILE=$(mktemp /tmp/axion-git-index.XXXXXX) || exit 2
  rev="${AXION_COMMIT:-}"
  if [ -z "$rev" ] || ! git cat-file -e "$rev^{commit}" 2>/dev/null; then rev=HEAD; fi
  if git read-tree "$rev"; then git update-index -q --refresh >/dev/null 2>&1 || true; echo "run-checks: git index of $rev (private, $GIT_INDEX_FILE)"
  else echo "run-checks: git read-tree $rev failed; the contract test that needs git history will fail" >&2; fi
fi

# the e2e scripts default to a host-specific Chromium path; use the one Playwright installed in this image
if [ -z "${PW_CHROME:-}" ]; then
  PW_CHROME=$(cd "$APP/web" && node -e "process.stdout.write(require('playwright').chromium.executablePath())") || PW_CHROME=""
  export PW_CHROME
fi

declare -A RC SECS
ORDER=()
step() { # step <name> <dir> <command...>
  local name=$1 dir=$2; shift 2
  local t; t=$(date +%s)
  echo "== $name ($dir: $*)"
  (cd "$APP/$dir" && "$@"); local rc=$?
  RC[$name]=$rc; SECS[$name]=$(( $(date +%s) - t )); ORDER+=("$name")
  echo "== $name: exit $rc in ${SECS[$name]} s"
}

rm -f "$OUT/vitest.json"
step server-typecheck server npm run typecheck
step server-tests server npx vitest run --reporter=json --outputFile="$OUT/vitest.json" --maxWorkers="${VITEST_MAX_WORKERS:-8}"
step web-typecheck web npm run typecheck
read -r -a E2E_SCRIPTS <<< "${AXION_E2E_SCRIPTS:-api-auth-flow.mjs}"
step browser-checks web env OUT="$OUT/e2e" bash scripts/api-e2e.sh "${E2E_SCRIPTS[@]}"

SECONDS_TOTAL=$(( $(date +%s) - T0 ))
STEPS_JSON="{"; ok=true
for n in "${ORDER[@]}"; do
  STEPS_JSON+="\"$n\":{\"exit\":${RC[$n]},\"seconds\":${SECS[$n]}},"
  [ "${RC[$n]}" -eq 0 ] || ok=false
done
STEPS_JSON="${STEPS_JSON%,}}"

# counts are the server tests' (vitest.json); a missing or unreadable file counts as one failure
OUT="$OUT" STEPS_JSON="$STEPS_JSON" OK="$ok" SECS_TOTAL="$SECONDS_TOTAL" node -e '
const fs = require("node:fs");
const out = process.env.OUT;
let passed = 0, failed = 1, skipped = 0, failures = [];
try {
  const v = JSON.parse(fs.readFileSync(out + "/vitest.json", "utf8"));
  passed = v.numPassedTests; failed = v.numFailedTests; skipped = (v.numPendingTests || 0) + (v.numTodoTests || 0);
  for (const f of v.testResults || []) {
    // a file that failed without a failed test (it did not load, or a hook threw) counts as one failure
    if (f.status === "failed" && !(f.assertionResults || []).some((a) => a.status === "failed")) { failed++; failures.push(f.name + ": " + String(f.message || "").split("\n")[0]); }
    for (const a of f.assertionResults || []) if (a.status === "failed") failures.push(f.name + " > " + a.fullName);
  }
} catch (e) { failures.push("vitest.json: " + e.message); }
const summary = { passed, failed, skipped, seconds: Number(process.env.SECS_TOTAL), ok: process.env.OK === "true", steps: JSON.parse(process.env.STEPS_JSON) };
fs.writeFileSync(out + "/summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log("== summary " + JSON.stringify(summary));
for (const f of failures.slice(0, 50)) console.log("   FAILED " + f);
'
rm -f "$APP/server/.env"
[ "$ok" = true ] && exit 0 || exit 1
