#!/bin/bash
set -euo pipefail
REPO="${1:-$HOME/Desktop/nma-build-os-master-sync}"
PORT="${PORT:-3001}"
cd "$REPO"

echo "================================================"
echo " NMA BUILD OS MASTER FINAL — TEST"
echo "================================================"
node --check server.js
node --check nma_master_final.js
node scripts/nma_final_smoke.mjs "$REPO"
npm audit --omit=dev --audit-level=moderate

echo "✅ Static checks PASS"

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ℹ️ Porta $PORT già occupata: non avvio un secondo server."
  echo "Apri http://localhost:$PORT/master"
  exit 0
fi

LOG="/tmp/nma_build_os_master_final_${PORT}.log"
PORT="$PORT" node server.js >"$LOG" 2>&1 &
PID=$!
cleanup(){ kill "$PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "✅ HTTP health PASS"
    echo "✅ Server locale avviabile"
    echo "➡️ Apri http://localhost:$PORT/master"
    echo "Log: $LOG"
    exit 0
  fi
  sleep 1
done

echo "❌ Server non pronto entro 30 secondi"
tail -80 "$LOG" || true
exit 1
