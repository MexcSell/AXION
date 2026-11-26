#!/usr/bin/env bash
# Backup before every switch (design §7.3 step 6, §13 B3): the AXION database only (never the other databases on this
# server), through the Unix socket as OS user `axion` (peer auth, no password), plus the shared data directory
# (uploads, audit anchors, the chat CLI home) archived next to the dump. Prints the dump path on the last line.
# Usage (root): evolve/backup.sh            Env: EVOLVE_ROOT (default /srv/axion-evolve)
set -euo pipefail
ROOT="${EVOLVE_ROOT:-/srv/axion-evolve}"
TOOLS="$ROOT/guard/tools"          # db-backup.mjs + its own node_modules/pg (installed by install.sh)
OUT="$ROOT/backups"
DATA="$ROOT/data"
[ "$(id -u)" = 0 ] || { echo "backup.sh runs as root (it switches to user axion)" >&2; exit 2; }
[ -f "$TOOLS/db-backup.mjs" ] || { echo "missing $TOOLS/db-backup.mjs: run evolve/install.sh" >&2; exit 2; }
install -d -m 700 -o axion -g axion "$OUT"
log=$(runuser -u axion -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent \
  DATABASE_URL='postgresql:///axion?host=/var/run/postgresql&user=axion' \
  BACKUP_DIR="$OUT" UPLOAD_DIR="$DATA/uploads" \
  node "$TOOLS/db-backup.mjs")
echo "$log"
dump=$(printf '%s\n' "$log" | sed -nE 's/^backup: ([^ ]+\.dump) .*/\1/p' | tail -1)
[ -n "$dump" ] && [ -f "$dump" ] || { echo "backup.sh: no dump path in db-backup output" >&2; exit 1; }
# the rest of the shared data (the uploads are already in the dump's own archive)
tar -czf "${dump%.dump}.data.tar.gz" -C "$DATA" --exclude=./uploads .
chown axion:axion "${dump%.dump}.data.tar.gz"; chmod 600 "${dump%.dump}.data.tar.gz"
echo "$dump"
