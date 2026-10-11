#!/bin/bash
set -e
cd "$(dirname "$0")"
PORT="${PORT:-3001}"
echo "NMA BUILD OS MASTER 4.7.0 UI/UX · CORE 4.6.0 — http://localhost:$PORT/master"
exec env PORT="$PORT" node server.js
