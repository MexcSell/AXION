#!/usr/bin/env bash
# Runs scripts/api-offline.mjs: Vite on 5193 with the API (5192) stopped; the script starts the API itself.
set -euo pipefail
cd "$(dirname "$0")/.."
for port in 5192 5193; do if ss -ltn "sport = :$port" | grep -q LISTEN; then echo "port $port is busy" >&2; exit 2; fi; done
setsid env AXION_API=http://127.0.0.1:5192 node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5193 --strictPort > /tmp/axion-offline-vite.log 2>&1 &
VITE=$!
trap 'kill -- -$VITE 2>/dev/null || true; P=$(ss -ltnpH "sport = :5192" | grep -o "pid=[0-9]*" | head -1 | cut -d= -f2); [ -n "$P" ] && kill $P || true' EXIT
for i in $(seq 1 60); do curl -sf http://127.0.0.1:5193/ >/dev/null && break; sleep 0.5; done
BASE=http://127.0.0.1:5193 node scripts/api-offline.mjs
