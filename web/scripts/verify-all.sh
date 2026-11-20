#!/usr/bin/env bash
# Full verification suite. Needs the dev server (npm run dev) on 127.0.0.1:5190, or BASE=... for preview.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-/tmp/axion-verify}"; mkdir -p "$OUT"
echo "== typecheck + build";   npm run -s build > "$OUT/build.log" 2>&1 && tail -1 "$OUT/build.log"
echo "== route×tab crawl";      node scripts/crawl.mjs "$OUT/crawl" dark luminous | tail -2
echo "== deep crawl";           node scripts/crawl-deep.mjs | tail -2
echo "== flows";                node scripts/flows.mjs | tail -24
echo "== auth flow (u1)";       node scripts/auth-flow.mjs | tail -19
echo "== u1 flows";             node scripts/u1-flows.mjs | tail -9
echo "== dialog smoke";         node scripts/dialog-smoke.mjs | tail -1
echo "== dialog ids";           node scripts/check-dialogs.mjs | tail -2
echo "== help keys";            node scripts/check-help.mjs | tail -1
echo "== dev-server file guard"; node scripts/fs-guard.mjs | tail -1
