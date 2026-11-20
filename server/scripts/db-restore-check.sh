#!/usr/bin/env bash
# Restore test: loads the newest dump into the scratch database axion_restore_check and compares its row counts with the
# manifest written from the same snapshot as the dump (older dumps without a manifest: with the live database).
# Exit 0 only when every table matches. BACKUP_SOURCE_URL (optional) checks another source, e.g. the e2e database. Only axion_restore_check is overwritten.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
DIR="${BACKUP_DIR:-$(cd .. && pwd)/backups}"
case "$RESTORE_DATABASE_URL" in *axion_restore_check*) ;; *) echo "RESTORE_DATABASE_URL must point at axion_restore_check" >&2; exit 2;; esac
DUMP=$(ls -1t "$DIR"/axion-*.dump 2>/dev/null | head -1 || true)
[ -n "$DUMP" ] || { echo "no dump in $DIR — run db-backup.sh first" >&2; exit 2; }
psql -q -d "$RESTORE_DATABASE_URL" -c 'set client_min_messages=warning; drop schema if exists public cascade; create schema public;'
pg_restore --no-owner -d "$RESTORE_DATABASE_URL" "$DUMP"
MANIFEST="${DUMP%.dump}.json"
TABLES="tenants users devices sessions audit_events missions mission_revisions mission_runs tasks uploads idempotency_keys events approval_requests approval_decisions notifications notification_reads schema_migrations"
fail=0
for t in $TABLES; do
  if [ -f "$MANIFEST" ]; then a=$(node -e "const m=require('$MANIFEST');process.stdout.write(String(m.counts['$t']??'?'))"); src=backup
  else a=$(psql -Atq -d "${BACKUP_SOURCE_URL:-$DATABASE_URL}" -c "select count(*) from $t"); src=live; fi
  b=$(psql -Atq -d "$RESTORE_DATABASE_URL" -c "select count(*) from $t")
  printf '%-20s %s=%-6s restored=%-6s %s\n' "$t" "$src" "$a" "$b" "$([ "$a" = "$b" ] && echo OK || echo DIFF)"
  [ "$a" = "$b" ] || fail=1
done
U="${DUMP%.dump}.uploads.tar.gz"
if [ -f "$U" ]; then tar -tzf "$U" >/dev/null && echo "uploads archive readable: $(tar -tzf "$U" | grep -vc '/$') files" || { echo "uploads archive unreadable"; fail=1; }; fi
echo "restore check of $(basename "$DUMP") against its $([ -f "$MANIFEST" ] && echo manifest || echo live database): $([ $fail = 0 ] && echo PASS || echo FAIL)"
exit $fail
