#!/usr/bin/env bash
# Backup of the AXION database only (never the other databases on this server): see db-backup.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --env-file=.env scripts/db-backup.mjs
