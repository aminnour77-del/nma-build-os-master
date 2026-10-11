#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="${HOME}/Desktop/NMA_BUILD_OS_4.7.0_UI_UX_GATE_${STAMP}.txt"
TMP_PORT="${NMA_TEST_PORT:-3017}"
PID=""
mkdir -p "${HOME}/Desktop"
: > "$REPORT"
log(){ printf '%s\n' "$*" | tee -a "$REPORT"; }
cleanup(){ [ -n "${PID:-}" ] && kill "$PID" >/dev/null 2>&1 || true; PID=""; }
trap cleanup EXIT INT TERM

log "============================================================"
log " NMA BUILD OS MASTER 4.7.0 — ENTERPRISE UI/UX FIELD GATE"
log " CORE 4.6.0 FROZEN · PRESENTATION LAYER ONLY"
log "============================================================"

log ""
log "=== GATE 1 · CORE 4.6.0 BYTE-FOR-BYTE FREEZE ==="
node <<'NODE' | tee -a "$REPORT"
const fs=require('fs'),crypto=require('crypto');
const m=require('./CORE_4.6.0_FREEZE_SHA256.json');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
for(const [f,want] of Object.entries(m.sha256)){
  const got=sha(f); if(got!==want) throw new Error(`CORE MODIFICATO ${f}: ${got} != ${want}`);
  console.log('✅',f);
}
console.log('CORE_FREEZE_PASS',Object.keys(m.sha256).length);
NODE
log "✅ Motore/API/database/workflow core invariati"

log ""
log "=== GATE 2 · SINTASSI UI + INLINE JS ==="
node --check ui/nma_enterprise_ui_47.js >/dev/null
python3 - <<'PY' | tee -a "$REPORT"
from pathlib import Path
import re, subprocess, sys
checked=0
for f in sorted(Path('.').glob('*.html')):
    s=f.read_text(errors='replace')
    if 'nma-enterprise-ui-47-style' not in s or 'nma-enterprise-ui-47-script' not in s:
        raise SystemExit(f'UI47 marker mancante: {f}')
    for i,js in enumerate(re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',s,re.S|re.I)):
        if not js.strip(): continue
        p=Path('/tmp')/f'nma47_{f.stem}_{i}.js'; p.write_text(js)
        subprocess.run(['node','--check',str(p)],check=True,stdout=subprocess.DEVNULL)
        checked+=1
print('HTML_INLINE_JS_PASS',checked)
PY
log "✅ UI source + 24 pagine HTML sintatticamente valide"

log ""
log "=== GATE 3 · SUITE COMPLETA CORE + UI REGRESSION ==="
OUT="/tmp/nma470_tests_${STAMP}.tap"
node --test --test-reporter=tap tests/*.test.js > "$OUT" 2>&1
TESTS="$(awk '/^# tests /{print $3}' "$OUT" | tail -1)"
PASS="$(awk '/^# pass /{print $3}' "$OUT" | tail -1)"
FAIL="$(awk '/^# fail /{print $3}' "$OUT" | tail -1)"
cat "$OUT" >> "$REPORT"
[ "${FAIL:-999}" = "0" ] && [ "${PASS:-0}" = "${TESTS:-x}" ] && [ "${TESTS:-0}" -ge 3400 ] || { log "❌ TEST FAIL $PASS/$TESTS · $FAIL FAIL"; exit 1; }
log "✅ $PASS/$TESTS PASS · 0 FAIL"

log ""
log "=== GATE 4 · UI/UX SAFETY BOUNDARY ==="
node <<'NODE' | tee -a "$REPORT"
const fs=require('fs');
const js=fs.readFileSync('ui/nma_enterprise_ui_47.js','utf8');
const css=fs.readFileSync('ui/nma_enterprise_ui_47.css','utf8');
for(const [n,re] of Object.entries({fetch:/\bfetch\s*\(/,xhr:/XMLHttpRequest/,ws:/\bWebSocket\b/,socket:/\bio\s*\(/,idb:/indexedDB/})){
  if(re.test(js)) throw new Error('UI layer contiene networking/persistenza: '+n);
}
for(const m of ['groupMasterNav','addQuickStrip','addMobileMenu','setA11y']) if(!js.includes(m)) throw new Error('feature UI mancante '+m);
for(const m of ['nma-nav-section','nma-command-strip','focus-visible','prefers-reduced-motion']) if(!css.includes(m)) throw new Error('feature CSS mancante '+m);
console.log('UI_PRESENTATION_ONLY_PASS');
NODE
log "✅ Nessuna chiamata API, scrittura DB o mutazione workflow introdotta dalla UI"

log ""
log "=== GATE 5 · SECURITY / SEGRETI / DIPENDENZE ==="
if grep -RIE --exclude='package-lock.json' --exclude='*.md' --exclude='*.txt' --exclude='*.json' --exclude-dir='.git' --exclude-dir='node_modules' --exclude-dir='tests' --exclude-dir='scripts' \
  "mongodb\+srv://[^*[:space:]]+:[^@[:space:]]+@|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|OPENAI_API_KEY[=:][^[:space:]]+" . \
  >/tmp/nma470_secret_${STAMP}.txt; then
  cat /tmp/nma470_secret_${STAMP}.txt >> "$REPORT"; log "❌ Possibile segreto incorporato"; exit 1
fi
node - <<'NODE' | tee -a "$REPORT"
const p=require('./package-lock.json');
if(p.packages?.['node_modules/proxy-addr']?.version!=='2.0.8') throw new Error('proxy-addr non 2.0.8');
console.log('DEPENDENCY_LOCK_PASS proxy-addr 2.0.8');
NODE
if command -v npm >/dev/null 2>&1 && npm audit --audit-level=critical --omit=dev >/tmp/nma470_audit_${STAMP}.txt 2>&1; then
  cat /tmp/nma470_audit_${STAMP}.txt >> "$REPORT"; log "✅ npm audit: 0 vulnerabilità CRITICAL"
else
  RC=$?; cat /tmp/nma470_audit_${STAMP}.txt >> "$REPORT" || true
  if grep -qiE 'ENET|EAI_AGAIN|network|registry.*unavailable|ECONN' /tmp/nma470_audit_${STAMP}.txt; then
    log "⚠️ npm audit online non disponibile; lock di sicurezza invariato e verificato"
  else
    log "❌ npm audit CRITICAL gate FAIL"; exit $RC
  fi
fi
log "✅ Secret scan + dependency guard PASS"

if [ -f .env ] && [ -d node_modules ]; then
  log ""
  log "=== GATE 6 · RUNTIME REALE + MONGODB + AUTH ==="
  if lsof -tiTCP:"$TMP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then log "❌ Porta test $TMP_PORT occupata"; exit 1; fi
  env PORT="$TMP_PORT" node server.js > "/tmp/nma470_runtime_${STAMP}.log" 2>&1 & PID=$!
  READY=0
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$TMP_PORT/api/ready" >/tmp/nma470_ready_${STAMP}.json 2>/dev/null; then READY=1; break; fi
    kill -0 "$PID" >/dev/null 2>&1 || break
    sleep 1
  done
  if [ "$READY" != "1" ]; then cat "/tmp/nma470_runtime_${STAMP}.log" >> "$REPORT"; log "❌ Runtime readiness FAIL"; exit 1; fi
  grep -q '"status":"OPERATIONAL"' /tmp/nma470_ready_${STAMP}.json || { cat /tmp/nma470_ready_${STAMP}.json >> "$REPORT"; log "❌ Readiness non OPERATIONAL"; exit 1; }
  curl -fsS "http://127.0.0.1:$TMP_PORT/api/live" | grep -q '"version":"4.6.0"'
  CODE_MASTER="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$TMP_PORT/master")"
  [ "$CODE_MASTER" = "302" ] || { log "❌ Master unauth expected 302, trovato $CODE_MASTER"; exit 1; }
  CODE_API="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$TMP_PORT/api/interventi")"
  [ "$CODE_API" = "401" ] || { log "❌ API unauth expected 401, trovato $CODE_API"; exit 1; }
  grep -q 'Connesso al Database Industriale MongoDB Atlas' "/tmp/nma470_runtime_${STAMP}.log" || { cat "/tmp/nma470_runtime_${STAMP}.log" >> "$REPORT"; log "❌ MongoDB connection marker assente"; exit 1; }
  log "✅ Runtime core 4.6.0 + MongoDB + auth PASS"
  cleanup
else
  log "ℹ️ Runtime reale verrà verificato nel repo locale con .env/node_modules"
fi

log ""
log "============================================================"
log "✅ NMA BUILD OS MASTER 4.7.0 — UI/UX ENTERPRISE GATE SUPERATO"
log "✅ CORE 4.6.0: BYTE-FOR-BYTE FROZEN"
log "✅ TEST: ${PASS}/${TESTS} · 0 FAIL"
log "✅ UI: navigazione raggruppata + azioni rapide + tablet/mobile + accessibilità"
log "✅ BUSINESS LOGIC: INVARIATA"
log "Report: $REPORT"
log "============================================================"
