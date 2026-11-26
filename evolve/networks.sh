# Docker networks of the Guard (evolution step 1), sourced by evolve/install.sh (bash). No side effects when sourced.
#
# The live network holds the slots (candidate code once it is live), the front and the egress proxy. It is internal AND has
# no IPv4 address on the host side of its bridge (com.docker.network.bridge.inhibit_ipv4): an internal network alone still
# lets its containers reach the host's own services on the bridge's gateway address (sshd, web servers; found in the final
# review). Containers on it still reach each other and Docker's DNS. The edge network (front + egress) is a normal bridge:
# the front publishes the site's port through it and the egress proxy reaches the internet through it; no candidate code
# is ever attached to it.
#
#   ensure_live_network <name>      create it isolated if missing; 0 = isolated, 3 = exists without the isolation (left
#                                   alone: recreating it interrupts the live site, see recreate_live_network)
#   recreate_live_network <name>    disconnect every container from it (running or stopped; only axion-* containers are
#                                   accepted), recreate it isolated, reconnect them, reload the front's nginx so it resolves
#                                   the slot's new address at once. The site is unreachable for a few seconds.
#   ensure_edge_network <name>      create it if missing (a normal bridge)
#   live_network_isolated <name>    0 when <name> is internal with inhibit_ipv4=true

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
  local net=$1 c members=() front=${2:-}
  if ! docker network inspect "$net" >/dev/null 2>&1; then ensure_live_network "$net"; return; fi
  if live_network_isolated "$net"; then echo "  already done: $net is isolated (nothing to recreate)"; return 0; fi
  # every container attached, running or stopped (the network filter reads the container's config)
  mapfile -t members < <(docker ps -a --filter "network=$net" --format '{{.Names}}')
  for c in "${members[@]}"; do
    case "$c" in axion|axion-*) ;; *) echo "  refusing: $c (not an axion container) is attached to $net" >&2; return 2 ;; esac
  done
  echo "  recreating $net with: ${members[*]:-(no containers)}"
  for c in "${members[@]}"; do docker network disconnect -f "$net" "$c"; done
  docker network rm "$net" >/dev/null
  docker network create "${ISOLATED_NET_OPTS[@]}" "$net" >/dev/null
  # the front last: the slots and the egress have their new addresses before nginx re-resolves the slot
  for c in "${members[@]}"; do [ "$c" = "$front" ] || docker network connect "$net" "$c"; done
  for c in "${members[@]}"; do [ "$c" != "$front" ] || docker network connect "$net" "$c"; done
  if [ -n "$front" ] && [ "$(docker inspect -f '{{.State.Running}}' "$front" 2>/dev/null)" = true ]; then
    docker exec "$front" nginx -s reload >/dev/null 2>&1 || echo "  warning: nginx -s reload in $front failed (it re-resolves the slot within 10 s anyway)"
  fi
  live_network_isolated "$net" || { echo "  $net is still not isolated" >&2; return 1; }
  echo "  recreated $net (internal, no IPv4 on the host side); reconnected: ${members[*]:-none}"
}
