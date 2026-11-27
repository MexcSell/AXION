#!/usr/bin/env bash
# Host install for AXION evolution steps 1 and 2 (design §7, §13 B3/B4). Idempotent: every step is skipped when already done.
# Run as root by Claude Code on the owner's word. It does NOT touch the shared PostgreSQL config, other apps' databases or
# containers. It retires the native site's systemd units (step 0). Step 2 adds the runner (axion-evolve): the Workshop
# network, image and token file, its directories and its systemd unit (enabled, NOT started: Claude Code starts it). It
# refuses while axion-evolve.service runs (stop it first: the Guard copy it runs from is replaced here). Usage:
#   evolve/install.sh [--recreate-live-network] <git-dir-of-the-AXION-repo> <commit>
#     e.g. evolve/install.sh /home/luca/AXION/.git evolve-step1
#   --recreate-live-network  recreate an existing live network that lacks the host isolation (inhibit_ipv4): the front,
#                            the slots and the egress proxy are disconnected and reconnected (a few seconds without the site).
#                            Without the flag such a network is left alone and the install ends with exit 3.
# Env: EVOLVE_ROOT (default /srv/axion-evolve), SRC_ENV_SERVER (default /home/luca/AXION/server/.env), SYSTEMD_DIR (/etc/systemd/system),
#      SRC_ENV_ROOT (default /home/luca/AXION/.env), SRC_DATA (default /home/luca/AXION/server/data), PREFIX (default axion)
set -euo pipefail
RECREATE_LIVE=0
if [ "${1:-}" = --recreate-live-network ]; then RECREATE_LIVE=1; shift; fi
GIT_SRC="${1:?git dir of the AXION repository}"; REV="${2:?commit to install the Guard from}"
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=install-lib.sh
. "$HERE/install-lib.sh"
PENDING=""
ROOT="${EVOLVE_ROOT:-/srv/axion-evolve}"; P="${PREFIX:-axion}"
SRC_ENV_SERVER="${SRC_ENV_SERVER:-/home/luca/AXION/server/.env}"; SRC_ENV_ROOT="${SRC_ENV_ROOT:-/home/luca/AXION/.env}"
SRC_DATA="${SRC_DATA:-/home/luca/AXION/server/data}"
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 2; }
if runner_running; then echo "install: axion-evolve.service is running; stop it first (systemctl stop axion-evolve), then start it again after the install" >&2; exit 2; fi
done_() { echo "  already done: $*"; }
step() { echo "== $*"; }
SHA=$(git --git-dir="$GIT_SRC" rev-parse --verify "$REV^{commit}")

step "0. the native site is retired (its systemd units would restart the old API on the live database, and the web unit
   would take 0.0.0.0:5190 back at a reboot)"
retire_native_units

step "1. OS user and group axion"
if id axion >/dev/null 2>&1; then done_ "user axion ($(id -u axion):$(id -g axion))"
else useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin axion; echo "  created axion ($(id -u axion):$(id -g axion))"; fi

step "2. directories under $ROOT"
install -d -m 755 "$ROOT" "$ROOT/front"
install -d -m 700 "$ROOT/secrets"
install -d -m 750 -o axion -g axion "$ROOT/data" "$ROOT/data/uploads" "$ROOT/data/cloud-home"
install -d -m 700 -o axion -g axion "$ROOT/backups"
echo "  ok"

step "3. bare repository and Guard code"
if [ -d "$ROOT/repo.git" ]; then done_ "repo.git"; else git init -q --bare "$ROOT/repo.git"; echo "  created repo.git"; fi
# a candidate's own .gitattributes must never change what `git archive` exports (Task 6 review I2)
install -d -m 755 "$ROOT/repo.git/info"
printf '* -export-ignore -export-subst\n' > "$ROOT/repo.git/info/attributes"
# the Guard runs from an exported copy of evolve/ at a fixed commit; agents' branches never reach it
cur=$(cat "$ROOT/guard/INSTALLED_COMMIT" 2>/dev/null || true)
if [ "$cur" = "$SHA" ]; then done_ "guard at $SHA"
else
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  git --git-dir="$GIT_SRC" archive "$SHA" evolve .dockerignore | tar -x -C "$tmp"
  install -d -m 755 "$tmp/tools"
  git --git-dir="$GIT_SRC" show "$SHA:server/scripts/db-backup.mjs" > "$tmp/tools/db-backup.mjs"
  pgv=$(git --git-dir="$GIT_SRC" show "$SHA:server/package-lock.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);process.stdout.write(l.packages["node_modules/pg"].version)})')
  (cd "$tmp/tools" && printf '{"name":"axion-guard-tools","private":true,"type":"module"}\n' > package.json && npm install --silent --no-audit --no-fund "pg@$pgv" >/dev/null)
  echo "$SHA" > "$tmp/INSTALLED_COMMIT"
  rm -rf "$ROOT/guard.new"; mv "$tmp" "$ROOT/guard.new"; trap - EXIT
  chmod -R go-w "$ROOT/guard.new"; chmod 755 "$ROOT/guard.new" "$ROOT/guard.new/tools"
  rm -rf "$ROOT/guard.old"; [ -d "$ROOT/guard" ] && mv "$ROOT/guard" "$ROOT/guard.old"; mv "$ROOT/guard.new" "$ROOT/guard"
  echo "  guard installed at $SHA (pg $pgv for backups)"
fi
ln -sfn "$ROOT/guard/evolve/bin/axion-guard" /usr/local/bin/axion-guard
ln -sfn "$ROOT/guard/evolve/bin/axion-evolve" /usr/local/bin/axion-evolve
chmod 755 "$ROOT/guard/evolve/bin/axion-guard" "$ROOT/guard/evolve/bin/axion-evolve" "$ROOT/guard/evolve/backup.sh"

step "4. secrets/live.env (mode 600; values never printed)"
if [ -f "$ROOT/secrets/live.env" ]; then done_ "live.env (delete it to rebuild)"
else
  umask 077
  { echo 'DATABASE_URL=postgresql:///axion?host=/var/run/postgresql&user=axion'
    # every other key from both env files, except database URLs, test settings, host/port, the anchor file path
    # (set per container) and Claude 1 (the live site uses Claude 2 only; design §13 B8)
    cat "$SRC_ENV_SERVER" "$SRC_ENV_ROOT" 2>/dev/null | grep -E '^[A-Z0-9_]+=' \
      | grep -vE '^(DATABASE_URL|TEST_DATABASE_URL|E2E_DATABASE_URL|RESTORE_DATABASE_URL|PGPASSWORD_[A-Z0-9_]*|HOST|PORT|DEMO_SEED|AUDIT_ANCHOR_FILE|UPLOAD_DIR|CLOUD_MODEL_HOME|BACKUP_DIR|CLAUDE_CODE_OAUTH_TOKEN1)=' ; } > "$ROOT/secrets/live.env"
  chmod 600 "$ROOT/secrets/live.env"
  echo "  written with keys: $(cut -d= -f1 "$ROOT/secrets/live.env" | tr '\n' ' ')"
fi

step "5. Docker networks and the egress proxy"
if [ "$RECREATE_LIVE" = 1 ]; then recreate_live_network "$P-live" "$P-front" || { echo "install: stopped: the live network could not be recreated (see above)" >&2; exit 1; }
else ensure_live_network "$P-live" || { [ $? = 3 ] && PENDING="$P-live needs --recreate-live-network"; }; fi
ensure_edge_network "$P-edge"
if docker container inspect "$P-egress" >/dev/null 2>&1; then
  # the proxy code comes from the Guard copy; recreate when the Guard was updated
  if [ "$(docker inspect -f '{{index .Config.Labels "axion.guard"}}' "$P-egress")" = "$SHA" ]; then done_ "$P-egress"
  else docker rm -f "$P-egress" >/dev/null; echo "  recreating $P-egress for guard $SHA"; fi
fi
if ! docker container inspect "$P-egress" >/dev/null 2>&1; then
  docker run -d --name "$P-egress" --label "axion.guard=$SHA" --network "$P-edge" --restart unless-stopped --init "${LOG_OPTS[@]}" \
    --user 1000:1000 --read-only -v "$ROOT/guard/evolve/egress:/egress:ro" \
    node:24-bookworm-slim node /egress/proxy.mjs >/dev/null
  docker network connect "$P-live" "$P-egress"
  echo "  started $P-egress (edge + live, port 3128, no published port)"
fi

step "6. shared data copied (not moved) from $SRC_DATA, only what the live data does not have yet"
# --ignore-existing: a file the live side already has is never replaced (with --update a newer stale native file could
# overwrite live data, e.g. the audit anchors the live site appends to)
copy_missing "$SRC_DATA/uploads/" "$ROOT/data/uploads/"
copy_missing "$SRC_DATA/audit-anchors.jsonl" "$ROOT/data/audit-anchors.jsonl"
copy_missing "$SRC_DATA/cloud-home/claude-2" "$ROOT/data/cloud-home/"
chown -R axion:axion "$ROOT/data"
echo "  ok ($(du -sh "$ROOT/data" | cut -f1))"

step "7. the Workshop (step 2): network $P-workshop (only way out: $P-egress), image, secrets/workshop.env"
ensure_workshop_network "$P-workshop" "$P-egress" || { rc=$?; [ "$rc" = 3 ] && PENDING="${PENDING:+$PENDING; }$P-workshop lacks the isolation" || { echo "install: stopped: the Workshop network (see above)" >&2; exit 1; }; }
ensure_workshop_image "axion-workshop:${SHA:0:12}" "$ROOT/guard/evolve/docker/workshop.Dockerfile" "$ROOT/guard/evolve/docker" \
  || { echo "install: stopped: the Workshop image (see above)" >&2; exit 1; }
write_workshop_env "$SRC_ENV_ROOT" "$ROOT/secrets/workshop.env" || { echo "install: stopped: secrets/workshop.env (see above)" >&2; exit 1; }

step "8. the runner (step 2): directories, axion-evolve.service (enabled, not started)"
# work/ is the Guard's scratch dir (it empties it before every deploy); the runner's change trees live in changes/
install -d -m 700 "$ROOT/work" "$ROOT/changes"
install_runner_unit "$ROOT/guard/evolve/runner/axion-evolve.service" "${SYSTEMD_DIR:-/etc/systemd/system}" \
  || { echo "install: stopped: the runner unit (see above)" >&2; exit 1; }
if [ -n "$PENDING" ]; then echo "install: done (guard $SHA), except: $PENDING"; exit 3; fi
echo "install: done (guard $SHA)"
