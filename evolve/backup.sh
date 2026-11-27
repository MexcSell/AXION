#!/usr/bin/env bash
# Backup before every switch (design §7.3 step 6, §13 B3): one AXION database only (never the other databases on this
# server), through the Unix socket as OS user `axion` (peer auth, no password), plus the shared data directory
# (uploads, audit anchors, the chat CLI home) archived next to the dump. Prints the dump path on the last line.
# Keeps the newest 14 backup sets (a set = axion-<utc>.dump, .json, .uploads.tar.gz, .data.tar.gz); a .data.tar.gz whose
# dump is gone is removed too.
# Usage (root): evolve/backup.sh
# Env (the contract with the Guard, effects-docker.ts backup()):
#   EVOLVE_ROOT           default /srv/axion-evolve
#   AXION_GUARD_DATABASE  the database the deploy's slots use (default axion); a lowercase PostgreSQL name, else refused
set -euo pipefail
# runuser lives in /usr/sbin, which a service's PATH may lack (axion-evolve.service started the Guard without it: M-137);
# appended, so a PATH that already names a runuser keeps it first
PATH="$PATH:/usr/sbin:/sbin"
ROOT="${EVOLVE_ROOT:-/srv/axion-evolve}"
DB="${AXION_GUARD_DATABASE:-axion}"
KEEP=14
TOOLS="$ROOT/guard/tools"          # db-backup.mjs + its own node_modules/pg (installed by install.sh)
OUT="$ROOT/backups"
DATA="$ROOT/data"
[ "$(id -u)" = 0 ] || { echo "backup.sh runs as root (it switches to user axion)" >&2; exit 2; }
[[ "$DB" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "backup.sh: AXION_GUARD_DATABASE is not a database name: '$DB'" >&2; exit 2; }
[ -f "$TOOLS/db-backup.mjs" ] || { echo "missing $TOOLS/db-backup.mjs: run evolve/install.sh" >&2; exit 2; }
install -d -m 700 -o axion -g axion "$OUT"
echo "backup.sh: database $DB"
log=$(runuser -u axion -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent \
  DATABASE_URL="postgresql:///$DB?host=/var/run/postgresql&user=axion" \
  BACKUP_DIR="$OUT" UPLOAD_DIR="$DATA/uploads" \
  node "$TOOLS/db-backup.mjs")
echo "$log"
dump=$(printf '%s\n' "$log" | sed -nE 's/^backup: ([^ ]+\.dump) .*/\1/p' | tail -1)
[ -n "$dump" ] && [ -f "$dump" ] || { echo "backup.sh: no dump path in db-backup output" >&2; exit 1; }
# the rest of the shared data (the uploads are already in the dump's own archive)
tar -czf "${dump%.dump}.data.tar.gz" -C "$DATA" --exclude=./uploads .
chown axion:axion "${dump%.dump}.data.tar.gz"; chmod 600 "${dump%.dump}.data.tar.gz"
# retention (db-backup.mjs prunes its own files to 14 but does not know the .data.tar.gz): the newest $KEEP sets stay
mapfile -t dumps < <(find "$OUT" -maxdepth 1 -type f -name 'axion-*.dump' -printf '%f\n' | sort -r)
for f in "${dumps[@]:$KEEP}"; do
  b="$OUT/${f%.dump}"; rm -f "$b.dump" "$b.json" "$b.uploads.tar.gz" "$b.data.tar.gz"
done
for f in "$OUT"/axion-*.data.tar.gz; do
  [ -e "$f" ] || continue
  [ -e "${f%.data.tar.gz}.dump" ] || rm -f "$f"
done
echo "$dump"
