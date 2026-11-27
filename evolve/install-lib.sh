# Functions of evolve/install.sh (evolution step 1), in their own file so they can be tested with fake `docker` and
# `systemctl` binaries (evolve/guard/install-lib.test.ts). Sourced by install.sh (bash); no side effects when sourced.
#
#   retire_native_units             disable --now axion-api.service / axion-web.service when enabled or active
#
# Docker networks:
# The live network holds the slots (candidate code once it is live), the front and the egress proxy. It is internal AND has
# no IPv4 address on the host side of its bridge (com.docker.network.bridge.inhibit_ipv4): an internal network alone still
# lets its containers reach the host's own services on the bridge's gateway address (sshd, web servers; found in the final
# review). Containers on it still reach each other and Docker's DNS. The edge network (front + egress) is a normal bridge:
# the front publishes the site's port through it and the egress proxy reaches the internet through it; no candidate code
# is ever attached to it.
#
#   ensure_live_network <name>      create it isolated if missing; 0 = isolated, 3 = exists without the isolation (left
#                                   alone: recreating it interrupts the live site, see recreate_live_network)
#   recreate_live_network <name> [front]  disconnect every container from it (running or stopped; only axion-* containers
#                                   are accepted), recreate it isolated, reconnect them (the front last), reload the front's
#                                   nginx so it resolves the slot's new address at once. The site is unreachable for about a
#                                   second. On any failure it puts back what it can (the network, isolated if possible, else
#                                   internal as before; every member reconnected), says what state it left and returns 1.
#                                   Call it as `recreate_live_network … || exit 1` (errexit is off inside, every step checked).
#   ensure_edge_network <name>      create it if missing (a normal bridge)
#   live_network_isolated <name>    0 when <name> is internal with inhibit_ipv4=true
#
# Evolution step 2 (the runner and its Workshop):
#   copy_missing <src> <dest>       rsync -a --ignore-existing: copies only what the destination does not have yet (an
#                                   old native file is never copied over live data, however new its mtime)
#   runner_running [<runner.lock>]  0 when axion-evolve.service is active/activating/deactivating, or a live process holds
#                                   runner.lock (an `once` or `approve`); install.sh refuses then: stop it first
#   ensure_workshop_network <name> <egress>  the Workshop's network, isolated like the live one (internal, no IPv4 on the
#                                   host side); recreated when it lacks the isolation and only the egress is attached (3 =
#                                   other members, left alone); the egress proxy connected to it (its only way out)
#   ensure_workshop_image <tag> <dockerfile> <context>  build it once per tag (the Guard's commit), legacy builder
#   write_workshop_env <src-env> <dest>  only when <dest> is missing: CLAUDE_CODE_OAUTH_TOKEN=<CLAUDE_CODE_OAUTH_TOKEN1 of
#                                   <src-env>>, mode 600; the value is never printed and never an argument (bash builtins)
#   install_runner_unit <unit> [<systemd-dir>]  install when changed + daemon-reload; never enabled, never started (R36:
#                                   Claude Code enables and starts it after the smoke)
#
# Step 2 fix wave:
#   ensure_system_user <name>       a non-login system user with its own group (useradd --system --user-group
#                                   --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin), once
#   require_nologin_user <name>     R31: 0 when <name> exists, its uid is not 0 and `getent passwd <uid>` gives a nologin/false
#                                   shell; else the reason on stderr, rc 1 (install.sh exits 2: no container may run as a uid
#                                   a login account owns, its processes could read /proc/<pid>/environ of the container)
#   guard_deploying <root>          I2: 0 (the reason on stdout) while a Guard deploy runs or was left unfinished: guard.lock
#                                   names a live pid of this boot (or holds no pid), or state.json has `deploying` (or cannot be
#                                   read); 1 = no deploy. The Guard runs detached and survives a stop of the runner
#                                   (KillMode=process), so runner_running alone does not see it.
#   prune_workshop_images <keep>    M9: removes every axion-workshop:<tag> image except <keep> (never -f, never another
#                                   repository); an image still in use is kept with a warning

retire_native_units() {
  local unit en ac
  for unit in axion-api.service axion-web.service; do
    if [ -z "$(systemctl list-unit-files --no-legend "$unit" 2>/dev/null)" ]; then echo "  already done: $unit (no such unit)"; continue; fi
    en=$(systemctl is-enabled "$unit" 2>/dev/null || true); ac=$(systemctl is-active "$unit" 2>/dev/null || true)
    if [ "$en" = enabled ] || [ "$ac" = active ] || [ "$ac" = activating ]; then
      systemctl disable --now "$unit" || return 1
      echo "  disabled and stopped $unit (was $en/$ac)"
    else echo "  already done: $unit ($en/$ac)"; fi
  done
}

ISOLATED_NET_OPTS=(--internal -o com.docker.network.bridge.inhibit_ipv4=true)
# every container the Guard or install.sh starts: bounded json-file logs
LOG_OPTS=(--log-opt max-size=10m --log-opt max-file=3)

live_network_isolated() {
  local v
  v=$(docker network inspect -f '{{.Internal}} {{index .Options "com.docker.network.bridge.inhibit_ipv4"}}' "$1" 2>/dev/null) || return 1
  [ "$v" = "true true" ]
}

ensure_live_network() {
  local net=$1
  if ! docker network inspect "$net" >/dev/null 2>&1; then
    docker network create "${ISOLATED_NET_OPTS[@]}" "$net" >/dev/null
    echo "  created $net (internal, no IPv4 on the host side)"
    return 0
  fi
  if live_network_isolated "$net"; then echo "  already done: $net (internal, no IPv4 on the host side)"; return 0; fi
  echo "  NEEDS --recreate-live-network: $net is internal but its bridge has an IPv4 address on the host, so its containers"
  echo "  reach host services (e.g. ssh on the gateway address). Not changed now: recreating it interrupts the live site for"
  echo "  a few seconds. Run: evolve/install.sh --recreate-live-network <git-dir> <commit>"
  return 3
}

ensure_edge_network() {
  local net=$1
  if docker network inspect "$net" >/dev/null 2>&1; then echo "  already done: $net"
  else docker network create "$net" >/dev/null; echo "  created $net"; fi
}

recreate_live_network() {
  local net=$1 front=${2:-} c fail="" members=() missing=()
  if ! docker network inspect "$net" >/dev/null 2>&1; then ensure_live_network "$net"; return; fi
  if live_network_isolated "$net"; then echo "  already done: $net is isolated (nothing to recreate)"; return 0; fi
  # every container attached, running or stopped (the network filter reads the container's config)
  mapfile -t members < <(docker ps -a --filter "network=$net" --format '{{.Names}}')
  for c in "${members[@]}"; do
    case "$c" in axion|axion-*) ;; *) echo "  refusing: $c (not an axion container) is attached to $net" >&2; return 2 ;; esac
  done
  echo "  recreating $net with: ${members[*]:-(no containers)}"
  for c in "${members[@]}"; do
    docker network disconnect -f "$net" "$c" || { fail="disconnecting $c"; break; }
  done
  [ -n "$fail" ] || docker network rm "$net" >/dev/null || fail="removing $net"
  [ -n "$fail" ] || docker network create "${ISOLATED_NET_OPTS[@]}" "$net" >/dev/null || fail="creating $net isolated"
  if [ -z "$fail" ]; then
    # the front last: the slots and the egress have their new addresses before nginx re-resolves the slot
    for c in "${members[@]}"; do [ "$c" = "$front" ] || docker network connect "$net" "$c" || missing+=("$c"); done
    for c in "${members[@]}"; do [ "$c" != "$front" ] || docker network connect "$net" "$c" || missing+=("$c"); done
    [ ${#missing[@]} -eq 0 ] || fail="reconnecting ${missing[*]}"
  fi
  if [ -n "$fail" ]; then
    echo "  FAILED while $fail; putting back what can be put back" >&2
    _live_restore "$net" "$front" "${members[@]}"
    return 1
  fi
  _reload_front "$front"
  live_network_isolated "$net" || { echo "  $net is still not isolated" >&2; return 1; }
  echo "  recreated $net (internal, no IPv4 on the host side); reconnected: ${members[*]:-none}"
}

_reload_front() {
  local front=$1
  if [ -n "$front" ] && [ "$(docker inspect -f '{{.State.Running}}' "$front" 2>/dev/null)" = true ]; then
    docker exec "$front" nginx -s reload >/dev/null 2>&1 || echo "  warning: nginx -s reload in $front failed (it re-resolves the slot within 10 s anyway)"
  fi
}

_attached() { # <container> <network>: 0 when the container's config has the network
  [ -n "$(docker inspect -f "{{if index .NetworkSettings.Networks \"$2\"}}yes{{end}}" "$1" 2>/dev/null)" ]
}

_live_restore() {
  local net=$1 front=$2 c left=(); shift 2
  if ! docker network inspect "$net" >/dev/null 2>&1; then
    docker network create "${ISOLATED_NET_OPTS[@]}" "$net" >/dev/null 2>&1 || docker network create --internal "$net" >/dev/null 2>&1 \
      || { echo "  RESTORE FAILED: $net is missing and cannot be created; detached: $*" >&2; return 1; }
  fi
  for c in "$@"; do
    _attached "$c" "$net" || docker network connect "$net" "$c" || left+=("$c")
  done
  _reload_front "$front"
  if [ ${#left[@]} -gt 0 ]; then echo "  RESTORE INCOMPLETE: $net exists, still detached: ${left[*]} (docker network connect $net <name>)" >&2; return 1; fi
  local iso='NOT isolated'
  if live_network_isolated "$net"; then iso=isolated; fi
  echo "  restored: $net exists ($iso), every member is connected again" >&2
}

copy_missing() {
  [ -e "$1" ] || { echo "  (no $1)"; return 0; }
  rsync -a --ignore-existing "$1" "$2"
}

runner_running() { # [<runner.lock>]: the unit active or activating, or a live process holds runner.lock (once/approve)
  local st pid
  st=$(systemctl is-active axion-evolve.service 2>/dev/null || true)
  case "$st" in active|activating|reloading|deactivating) return 0 ;; esac
  if [ -n "${1:-}" ] && [ -f "$1" ]; then
    pid=$(head -n 1 "$1" 2>/dev/null || true)
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null; then return 0; fi
  fi
  return 1
}

ensure_workshop_network() {
  local net=$1 egress=$2 others=()
  if docker network inspect "$net" >/dev/null 2>&1 && ! live_network_isolated "$net"; then
    mapfile -t others < <(docker ps -a --filter "network=$net" --format '{{.Names}}' | grep -vxF -- "$egress" | grep -v '^$' || true)
    if [ ${#others[@]} -gt 0 ]; then
      echo "  refusing: $net lacks the isolation and has other members: ${others[*]} (remove them, then run install again)" >&2
      return 3
    fi
    if _attached "$egress" "$net"; then docker network disconnect -f "$net" "$egress" || return 1; fi
    docker network rm "$net" >/dev/null || return 1
    echo "  removed $net (it lacked the isolation)"
  fi
  if docker network inspect "$net" >/dev/null 2>&1; then echo "  already done: $net (internal, no IPv4 on the host side)"
  else
    docker network create "${ISOLATED_NET_OPTS[@]}" "$net" >/dev/null || return 1
    echo "  created $net (internal, no IPv4 on the host side)"
  fi
  if ! docker container inspect "$egress" >/dev/null 2>&1; then echo "  $egress is missing; not connected to $net" >&2; return 1; fi
  if _attached "$egress" "$net"; then echo "  already done: $egress on $net"
  else docker network connect "$net" "$egress" || return 1; echo "  connected $egress to $net (the Workshop's only way out)"; fi
}

ensure_workshop_image() {
  local tag=$1 file=$2 ctx=$3
  if docker image inspect "$tag" >/dev/null 2>&1; then echo "  already done: $tag"; return 0; fi
  DOCKER_BUILDKIT=0 docker build -q -f "$file" -t "$tag" "$ctx" >/dev/null || { echo "  building $tag failed" >&2; return 1; }
  echo "  built $tag"
}

write_workshop_env() {
  local src=$1 dest=$2 v=""
  if [ -f "$dest" ]; then echo "  already done: $(basename "$dest") (delete it to rebuild)"; return 0; fi
  # the value travels through a pipe and a variable only; printf is a bash builtin (no process, nothing in ps)
  v=$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN1=' "$src" 2>/dev/null | tail -n 1 | cut -d= -f2-) || v=""
  v=${v%$'\r'}
  case "$v" in \"*\") v=${v#\"}; v=${v%\"} ;; \'*\') v=${v#\'}; v=${v%\'} ;; esac
  if [ ${#v} -lt 20 ]; then echo "  CLAUDE_CODE_OAUTH_TOKEN1 is missing or too short in $src; $(basename "$dest") not written" >&2; return 1; fi
  rm -f "$dest.tmp"
  ( umask 077; printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$v" > "$dest.tmp" ) || return 1
  chmod 600 "$dest.tmp" || return 1
  mv -f "$dest.tmp" "$dest" || return 1
  v=""
  echo "  written $(basename "$dest") (mode 600, one key: CLAUDE_CODE_OAUTH_TOKEN; the value is not shown)"
}

install_runner_unit() {
  local src=$1 dir=${2:-/etc/systemd/system} name
  name=$(basename "$src")
  if cmp -s "$src" "$dir/$name"; then echo "  already done: $dir/$name"
  else
    install -m 644 "$src" "$dir/$name" || return 1
    systemctl daemon-reload || return 1
    echo "  installed $dir/$name (not enabled, not started: Claude Code enables and starts it after the smoke; R36)"
  fi
}

ensure_system_user() {
  local name=$1
  if id "$name" >/dev/null 2>&1; then echo "  already done: user $name ($(id -u "$name"):$(id -g "$name"))"; return 0; fi
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$name" || return 1
  echo "  created $name ($(id -u "$name"):$(id -g "$name"), no login shell, no home)"
}

require_nologin_user() {
  local name=$1 uid line shell
  if ! uid=$(id -u "$name" 2>/dev/null); then echo "  refusing: the user $name does not exist" >&2; return 1; fi
  if ! [[ "$uid" =~ ^[0-9]+$ ]] || [ "$uid" = 0 ]; then echo "  refusing: $name has uid ${uid:-?} (uid 0 never runs a container of the stack)" >&2; return 1; fi
  line=$(getent passwd "$uid" | head -n 1) || line=""
  shell=${line##*:}
  case "$shell" in
    /usr/sbin/nologin|/sbin/nologin|/bin/false|/usr/bin/false) return 0 ;;
  esac
  echo "  refusing: uid $uid ($name) resolves to the account ${line%%:*} with the login shell ${shell:-?}: its processes could read" >&2
  echo "  the environment of a container running as that uid (/proc/<pid>/environ) and write into it. Give $name its own non-login uid." >&2
  return 1
}

guard_deploying() {
  local root=$1 pid="" boot="" now="" st
  if [ -f "$root/guard.lock" ]; then
    pid=$(sed -n 1p "$root/guard.lock" 2>/dev/null | tr -d '[:space:]') || pid=""
    boot=$(sed -n 2p "$root/guard.lock" 2>/dev/null | tr -d '[:space:]') || boot=""
    now=$(cat "${AXION_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}" 2>/dev/null | tr -d '[:space:]') || now=""
    if ! [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
      echo "$root/guard.lock holds no pid (the Guard refuses to deploy while it exists); see axion-guard status"; return 0
    fi
    if { [ -z "$boot" ] || [ -z "$now" ] || [ "$boot" = "$now" ]; } && kill -0 "$pid" 2>/dev/null; then
      echo "an axion-guard deploy is running (pid $pid holds $root/guard.lock); wait for it to end (axion-guard status)"; return 0
    fi
  fi
  if [ -f "$root/state.json" ]; then
    st=$(node -e '
      let s; try { s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch { process.stdout.write("bad"); process.exit(0); }
      const d = s && s.deploying;
      if (d) process.stdout.write(`deploying ${String(d.sha).slice(0, 12)} ${String(d.step)} ${String(d.startedAt)}`);' "$root/state.json" 2>/dev/null) || st=bad
    case "$st" in
      bad) echo "$root/state.json cannot be read; see axion-guard status before installing"; return 0 ;;
      deploying*) set -- $st; echo "state.json records an unfinished deploy of $2 at $3 (since $4): axion-guard status, then axion-guard rollback if no Guard runs"; return 0 ;;
    esac
  fi
  return 1
}

prune_workshop_images() {
  local keep=$1 ref n=0 refs=()
  mapfile -t refs < <(docker image ls --format '{{.Repository}}:{{.Tag}}' axion-workshop 2>/dev/null | grep '^axion-workshop:' || true)
  for ref in "${refs[@]}"; do
    [ "$ref" != "$keep" ] || continue
    [ "${ref%%:*}" = axion-workshop ] || continue
    if docker image rm "$ref" >/dev/null 2>&1; then echo "  removed $ref"; n=$((n + 1))
    else echo "  warning: $ref kept (still in use or not removable)" >&2; fi
  done
  if [ "$n" = 0 ]; then echo "  already done: no other axion-workshop image to remove (keeping $keep)"; fi
}
