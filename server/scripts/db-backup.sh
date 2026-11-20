#!/usr/bin/env bash
# Backup of the AXION database only: pg_dump -Fc axion → /home/luca/AXION/backups/axion-<UTC>.dump, keeps the newest 14.
# Never touches the other databases on this PostgreSQL server.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
DIR="${BACKUP_DIR:-$(cd .. && pwd)/backups}"
mkdir -p "$DIR"; chmod 700 "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DIR/axion-$STAMP.dump"
pg_dump -Fc --no-owner -d "${BACKUP_SOURCE_URL:-$DATABASE_URL}" -f "$OUT.part"
mv "$OUT.part" "$OUT"; chmod 600 "$OUT"
ls -1t "$DIR"/axion-*.dump | tail -n +15 | xargs -r rm -f
echo "backup: $OUT ($(stat -c %s "$OUT") bytes)"
