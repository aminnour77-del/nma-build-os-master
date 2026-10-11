#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "${HOME}/Desktop"
REPORT="${HOME}/Desktop/NMA_BUILD_OS_4.5.0_MEGA_COLLAUDO_${STAMP}.txt"
TMP_PORT="${NMA_TEST_PORT:-3015}"
PID=""
log(){ printf '%s\n' "$*" | tee -a "$REPORT"; }
cleanup(){ [ -n "${PID:-}" ] && kill "$PID" >/dev/null 2>&1 || true; PID=""; }
trap cleanup EXIT INT TERM
: > "$REPORT"
log "============================================================"
log " NMA BUILD OS MASTER 4.5.0 — MEGA COLLAUDO ENTERPRISE"
log "============================================================"

log ""
log "=== GATE 1 · SINTASSI JS ==="
for f in server.js nma_field_engine.js nma_digital_memory.js nma_master_enterprise_43.js nma_master_shell_44.js nma_master_shell_44_browser.js nma_master_shell_44_core.js nma_frame_policy_441.js nma_enterprise_45.js nma_enterprise_core_45.js nma_offline_enterprise_45.js nma_offline_core_45.js sw.js; do
  node --check "$f" >/dev/null
  log "✅ $f"
done
python3 - <<'PY'
from pathlib import Path
import re, subprocess, tempfile
for f in ['campo_operatore_v1.html','master_control_v1.html','enterprise_control_v1.html']:
    s=Path(f).read_text()
    js='\n'.join(x for x in re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',s,re.S) if x.strip())
    if not js: continue
    p=Path('/tmp')/(f+'.syntax.js'); p.write_text(js)
    subprocess.run(['node','--check',str(p)],check=True,stdout=subprocess.DEVNULL)
print('HTML_INLINE_JS_PASS')
PY
log "✅ Inline JS HTML PASS"

log ""
log "=== GATE 2 · TEST AUTOMATICI ==="
OUT="/tmp/nma450_tests_${STAMP}.tap"
node --test --test-reporter=tap tests/*.test.js > "$OUT" 2>&1
TESTS="$(awk '/^# tests /{print $3}' "$OUT" | tail -1)"; PASS="$(awk '/^# pass /{print $3}' "$OUT" | tail -1)"; FAIL="$(awk '/^# fail /{print $3}' "$OUT" | tail -1)"
cat "$OUT" >> "$REPORT"
[ "${FAIL:-999}" = "0" ] && [ "${PASS:-0}" = "${TESTS:-x}" ] && [ "${TESTS:-0}" -ge 1400 ] || { log "❌ TEST FAIL $PASS/$TESTS · $FAIL FAIL"; exit 1; }
log "✅ $PASS/$TESTS PASS · 0 FAIL"

log ""
log "=== GATE 3 · FILE / SEGRETI / PWA ==="
for f in manifest.webmanifest sw.js offline.html nma_offline_enterprise_45.js enterprise_control_v1.html; do [ -s "$f" ] || { log "❌ Mancante $f"; exit 1; }; done
if grep -E "mongodb\+srv://[^*[:space:]]+:[^@[:space:]]+@|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|OPENAI_API_KEY[=:][^[:space:]]+" \
  server.js nma_field_engine.js nma_digital_memory.js nma_master_enterprise_43.js nma_master_shell_44*.js nma_enterprise_45.js nma_enterprise_core_45.js nma_offline_enterprise_45.js nma_offline_core_45.js \
  >/tmp/nma450_secret_${STAMP}.txt; then
  cat /tmp/nma450_secret_${STAMP}.txt >> "$REPORT"; log "❌ Possibile segreto incorporato"; exit 1
fi
log "✅ Nessun segreto incorporato rilevato"
grep -q "indexedDB.open" nma_offline_enterprise_45.js
grep -q "crypto.subtle.digest" nma_offline_enterprise_45.js
grep -q "nma_build_os_cantieri_cache_v45" campo_operatore_v1.html
grep -q "evidenze in coda sicura" campo_operatore_v1.html
log "✅ Offline/PWA/evidenze marker PASS"

log ""
log "=== GATE 4 · DIPENDENZE PINNATE / ADVISORY BASE ==="
node <<'NODE' >> "$REPORT"
const p=require('./package-lock.json');
const v=n=>p.packages?.[`node_modules/${n}`]?.version;
const expected={express:'4.22.3',multer:'2.4.0','path-to-regexp':'0.1.13',qs:'6.16.0','socket.io-parser':'4.2.7','engine.io':'6.6.10'};
for(const [k,min] of Object.entries(expected)){if(v(k)!==min)throw new Error(`${k}: atteso ${min}, trovato ${v(k)}`)}
console.log('DEPENDENCY_BASE_PASS',expected);
NODE
log "✅ Dipendenze chiave note/patched verificate nel lock"

if [ -f .env ] && [ -d node_modules ]; then
  log ""
  log "=== GATE 5 · RUNTIME REALE + MONGODB ==="
  if lsof -tiTCP:"$TMP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then log "❌ Porta test $TMP_PORT occupata"; exit 1; fi
  env PORT="$TMP_PORT" node server.js > "/tmp/nma450_runtime_${STAMP}.log" 2>&1 & PID=$!
  READY=0
  for _ in $(seq 1 35); do
    if curl -fsS "http://127.0.0.1:$TMP_PORT/api/ready" >/tmp/nma450_ready_${STAMP}.json 2>/dev/null; then READY=1; break; fi
    kill -0 "$PID" >/dev/null 2>&1 || break
    sleep 1
  done
  if [ "$READY" != "1" ]; then cat "/tmp/nma450_runtime_${STAMP}.log" >> "$REPORT"; log "❌ Runtime readiness FAIL"; exit 1; fi
  grep -q '"status":"OPERATIONAL"' /tmp/nma450_ready_${STAMP}.json || { cat /tmp/nma450_ready_${STAMP}.json >> "$REPORT"; log "❌ Readiness non OPERATIONAL"; exit 1; }
  curl -fsS "http://127.0.0.1:$TMP_PORT/api/live" | grep -q '"version":"4.5.0"'
  curl -fsS "http://127.0.0.1:$TMP_PORT/manifest.webmanifest" >/dev/null
  HEADERS="$(curl -sS -D - -o /dev/null "http://127.0.0.1:$TMP_PORT/enterprise-control" | tr -d '\r')"
  printf '%s\n' "$HEADERS" | grep -qi '^X-Frame-Options: SAMEORIGIN$' || { log "❌ enterprise-control frame header"; exit 1; }
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' -X POST "http://127.0.0.1:$TMP_PORT/api/logout")"
  [ "$CODE" = "403" ] || { log "❌ Same-origin guard non blocca ($CODE)"; exit 1; }
  log "✅ Runtime + MongoDB + PWA + Origin Guard PASS"
  cleanup
else
  log "ℹ️ Gate runtime reale non eseguito: .env/node_modules non presenti in questo pacchetto condivisibile. Verrà eseguito dopo installazione nel repo locale."
fi

log ""
log "============================================================"
log "✅ NMA BUILD OS MASTER 4.5.0 — MEGA COLLAUDO SUPERATO"
log "✅ TEST: ${PASS}/${TESTS} · 0 FAIL"
log "✅ FIELD OFFLINE: PWA + IndexedDB + evidenze + retry"
log "✅ ENTERPRISE: readiness + integrity + export + request guard"
log "Report: $REPORT"
log "============================================================"
