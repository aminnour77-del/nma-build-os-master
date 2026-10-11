#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3001}"
echo "NMA BUILD OS MASTER 4.5.0 — AVVIO"
echo "http://localhost:${PORT}/master"
exec env PORT="$PORT" node server.js
