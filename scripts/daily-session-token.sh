#!/usr/bin/env bash
# Daily Flattrade session-token job — Oracle/cron equivalent of EventBridge → Lambda.
#
# Schedule example (crontab on the VM, IST via TZ):
#   TZ=Asia/Kolkata
#   15 8 * * 1-5 /opt/atlas/scripts/daily-session-token.sh >> /var/log/atlas-token.log 2>&1
#
# Or rely on Atlas -serve which schedules the same job internally at session_token_job.hour_ist.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CONFIG="${ATLAS_CONFIG:-configs/atlas.example.yaml}"
BIN="${ATLAS_BIN:-$ROOT/bin/atlas}"

if [[ ! -x "$BIN" ]]; then
  echo "building atlas..."
  make -C "$ROOT" build
fi

echo "$(date -Is) starting session token job"
exec "$BIN" -config "$CONFIG" -token-job
