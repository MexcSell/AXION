#!/usr/bin/env bash
# c74 (H19): does the dev server notice changes under shared/contracts/src the way a merge makes them?
# Each round: atomic rename of index.ts (new inode) that also adds an export from a NEW file, then curl the served module.
# Usage: BASE=http://127.0.0.1:12290 [ROUNDS=10] ./scripts/shared-watch-check.sh   (exit 0 = every round served the new export)
# Restores index.ts and removes the probe files on exit. Only touches shared/contracts/src/index.ts and shared/contracts/src/zz-watch-probe-*.ts.
set -u
BASE=${BASE:?set BASE, e.g. http://127.0.0.1:12290}; ROUNDS=${ROUNDS:-10}; WAIT=${WAIT:-5}
SRC=$(cd "$(dirname "$0")/../../shared/contracts/src" && pwd); IDX=$SRC/index.ts; BAK=$(mktemp)
cp "$IDX" "$BAK"
cleanup() { cp "$BAK" "$IDX.tmp-restore" && mv "$IDX.tmp-restore" "$IDX"; rm -f "$SRC"/zz-watch-probe-*.ts "$BAK"; }
trap cleanup EXIT
served() { curl -s --max-time 5 "$BASE/@fs$IDX"; }
served >/dev/null   # load it into the module graph first, as a browser would
ok=0
for i in $(seq 1 "$ROUNDS"); do
  P=zz-watch-probe-$i
  echo "export const probe$i = $i;" > "$SRC/$P.ts"                       # new file
  { cat "$BAK"; for j in $(seq 1 "$i"); do echo "export * from './zz-watch-probe-$j';"; done; } > "$IDX.tmp"
  mv "$IDX.tmp" "$IDX"                                                  # atomic rename = new inode, as git merge does
  hit=0
  for _ in $(seq 1 $((WAIT*10))); do
    if served | grep -q "zz-watch-probe-$i"; then hit=1; break; fi
    sleep 0.1
  done
  if [ $hit = 1 ]; then ok=$((ok+1)); echo "round $i: FRESH"; else echo "round $i: STALE after ${WAIT}s"; fi
done
echo "RESULT $ok/$ROUNDS fresh"
[ "$ok" = "$ROUNDS" ]
