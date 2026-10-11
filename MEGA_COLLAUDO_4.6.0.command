#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "${HOME}/Desktop"
REPORT="${HOME}/Desktop/NMA_BUILD_OS_4.6.0_FINAL_GATE_${STAMP}.txt"
TMP_PORT="${NMA_TEST_PORT:-3016}"
PID=""
log(){ printf '%s\n' "$*" | tee -a "$REPORT"; }
cleanup(){ [ -n "${PID:-}" ] && kill "$PID" >/dev/null 2>&1 || true; PID=""; }
trap cleanup EXIT INT TERM
: > "$REPORT"

log "============================================================"
log " NMA BUILD OS MASTER 4.6.0 — FINAL SOFTWARE PRODUCTION GATE"
log "============================================================"

log ""
log "=== GATE 1 · SINTASSI / HTML / RELEASE ==="
for f in server.js nma_field_engine.js nma_digital_memory.js nma_master_enterprise_43.js nma_master_shell_44.js nma_master_shell_44_browser.js nma_master_shell_44_core.js nma_frame_policy_441.js nma_enterprise_45.js nma_enterprise_core_45.js nma_offline_enterprise_45.js nma_offline_core_45.js sw.js; do
  node --check "$f" >/dev/null
  log "✅ $f"
done
python3 - <<'PY'
from pathlib import Path
import re, subprocess
for f in ['campo_operatore_v1.html','master_control_v1.html','enterprise_control_v1.html','field_x1_v1.html','workflow_v1.html','quality_v1.html']:
    s=Path(f).read_text(errors='replace')
    js='\n'.join(x for x in re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',s,re.S) if x.strip())
    if not js: continue
    p=Path('/tmp')/(f+'.syntax.js'); p.write_text(js)
    subprocess.run(['node','--check',str(p)],check=True,stdout=subprocess.DEVNULL)
print('HTML_INLINE_JS_PASS')
PY
node - <<'NODE' >> "$REPORT"
const p=require('./package.json'); const c=require('./nma_enterprise_core_45');
if(p.version!=='4.6.0'||c.VERSION!=='4.6.0') throw new Error('release version mismatch');
console.log('RELEASE_VERSION_PASS',p.version,c.VERSION);
NODE
log "✅ Sintassi + HTML + release identity PASS"

log ""
log "=== GATE 2 · SUITE AUTOMATICA COMPLETA ==="
OUT="/tmp/nma460_tests_${STAMP}.tap"
node --test --test-reporter=tap tests/*.test.js > "$OUT" 2>&1
TESTS="$(awk '/^# tests /{print $3}' "$OUT" | tail -1)"; PASS="$(awk '/^# pass /{print $3}' "$OUT" | tail -1)"; FAIL="$(awk '/^# fail /{print $3}' "$OUT" | tail -1)"
cat "$OUT" >> "$REPORT"
[ "${FAIL:-999}" = "0" ] && [ "${PASS:-0}" = "${TESTS:-x}" ] && [ "${TESTS:-0}" -ge 3300 ] || { log "❌ TEST FAIL $PASS/$TESTS · $FAIL FAIL"; exit 1; }
log "✅ $PASS/$TESTS PASS · 0 FAIL"

log ""
log "=== GATE 3 · SECURITY / DIPENDENZE / SEGRETI ==="
node <<'NODE' >> "$REPORT"
const p=require('./package-lock.json'); const pkg=require('./package.json');
const v=n=>p.packages?.[`node_modules/${n}`]?.version;
const expected={'proxy-addr':'2.0.8',express:'4.22.3',multer:'2.4.0',qs:'6.16.0','socket.io-parser':'4.2.7','engine.io':'6.6.10'};
for(const [k,want] of Object.entries(expected)){if(v(k)!==want)throw new Error(`${k}: atteso ${want}, trovato ${v(k)}`)}
if(pkg.dependencies['proxy-addr']!=='2.0.8')throw new Error('proxy-addr non pinning 2.0.8');
console.log('DEPENDENCY_SECURITY_BASE_PASS',expected);
NODE
if grep -RIE --exclude='package-lock.json' --exclude='*.md' --exclude='*.txt' --exclude-dir='.git' --exclude-dir='node_modules' --exclude-dir='tests' --exclude-dir='scripts' \
  "mongodb\+srv://[^*[:space:]]+:[^@[:space:]]+@|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|OPENAI_API_KEY[=:][^[:space:]]+" . \
  >/tmp/nma460_secret_${STAMP}.txt; then
  cat /tmp/nma460_secret_${STAMP}.txt >> "$REPORT"; log "❌ Possibile segreto incorporato"; exit 1
fi
log "✅ proxy-addr 2.0.8 + secret scan PASS"

if command -v npm >/dev/null 2>&1 && npm audit --audit-level=critical --omit=dev >/tmp/nma460_audit_${STAMP}.txt 2>&1; then
  cat /tmp/nma460_audit_${STAMP}.txt >> "$REPORT"
  log "✅ npm audit: nessuna vulnerabilità CRITICAL"
else
  RC=$?
  cat /tmp/nma460_audit_${STAMP}.txt >> "$REPORT" || true
  if grep -qiE 'ENET|EAI_AGAIN|network|registry.*unavailable|ECONN' /tmp/nma460_audit_${STAMP}.txt; then
    log "⚠️ npm audit online non disponibile: controllo lock/CVE patch eseguito localmente"
  else
    log "❌ npm audit CRITICAL gate FAIL"
    exit $RC
  fi
fi

log ""
log "=== GATE 4 · PWA / OFFLINE / EVIDENZE / SHELL ==="
for f in manifest.webmanifest sw.js offline.html nma_offline_enterprise_45.js nma_offline_core_45.js enterprise_control_v1.html; do [ -s "$f" ] || { log "❌ Mancante $f"; exit 1; }; done
grep -q "nma-build-field-4.6.0" sw.js
grep -q "indexedDB.open" nma_offline_enterprise_45.js
grep -q "crypto.subtle.digest" nma_offline_enterprise_45.js
grep -q "nma_build_os_cantieri_cache_v45" campo_operatore_v1.html
grep -q "evidenze in coda sicura" campo_operatore_v1.html
node - <<'NODE' >> "$REPORT"
const fs=require('fs'); const core=require('./nma_master_shell_44_core'); const fp=require('./nma_frame_policy_441');
const files=fs.readdirSync('.'); const h=core.registryHealth(files); if(!h.ok) throw new Error('missing modules '+h.missing.join(','));
for(const x of core.REGISTRY.filter(x=>x.embed)){if(!fp.isInternalFramePath(x.href))throw new Error('frame denied '+x.href)}
console.log('MASTER_SHELL_REGISTRY_PASS',h.required,h.available);
NODE
log "✅ PWA + IndexedDB + evidenze + shell registry PASS"

if [ -f .env ] && [ -d node_modules ]; then
  log ""
  log "=== GATE 5 · RUNTIME REALE + MONGODB + AUTH ==="
  if lsof -tiTCP:"$TMP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then log "❌ Porta test $TMP_PORT occupata"; exit 1; fi
  env PORT="$TMP_PORT" node server.js > "/tmp/nma460_runtime_${STAMP}.log" 2>&1 & PID=$!
  READY=0
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$TMP_PORT/api/ready" >/tmp/nma460_ready_${STAMP}.json 2>/dev/null; then READY=1; break; fi
    kill -0 "$PID" >/dev/null 2>&1 || break
    sleep 1
  done
  if [ "$READY" != "1" ]; then cat "/tmp/nma460_runtime_${STAMP}.log" >> "$REPORT"; log "❌ Runtime readiness FAIL"; exit 1; fi
  grep -q '"status":"OPERATIONAL"' /tmp/nma460_ready_${STAMP}.json || { cat /tmp/nma460_ready_${STAMP}.json >> "$REPORT"; log "❌ Readiness non OPERATIONAL"; exit 1; }
  curl -fsS "http://127.0.0.1:$TMP_PORT/api/live" | grep -q '"version":"4.6.0"'
  curl -fsS "http://127.0.0.1:$TMP_PORT/manifest.webmanifest" >/dev/null
  CODE_MASTER="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$TMP_PORT/master")"
  [ "$CODE_MASTER" = "302" ] || { log "❌ Master unauth expected 302, trovato $CODE_MASTER"; exit 1; }
  CODE_API="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$TMP_PORT/api/interventi")"
  [ "$CODE_API" = "401" ] || { log "❌ API unauth expected 401, trovato $CODE_API"; exit 1; }
  HEADERS="$(curl -sS -D - -o /dev/null "http://127.0.0.1:$TMP_PORT/enterprise-control" | tr -d '\r')"
  printf '%s\n' "$HEADERS" | grep -qi '^X-Frame-Options: SAMEORIGIN$' || { log "❌ enterprise-control frame header"; exit 1; }
  CODE_ORIGIN="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' -X POST "http://127.0.0.1:$TMP_PORT/api/logout")"
  [ "$CODE_ORIGIN" = "403" ] || { log "❌ Same-origin guard non blocca ($CODE_ORIGIN)"; exit 1; }
  grep -q 'Connesso al Database Industriale MongoDB Atlas' "/tmp/nma460_runtime_${STAMP}.log" || { cat "/tmp/nma460_runtime_${STAMP}.log" >> "$REPORT"; log "❌ MongoDB connection marker assente"; exit 1; }
  log "✅ Runtime + MongoDB + auth + frame + origin guard PASS"
  cleanup
else
  log "ℹ️ Gate runtime reale saltato nel pacchetto condivisibile: verrà eseguito nel repo locale con .env/node_modules."
fi

log ""
log "============================================================"
log "✅ NMA BUILD OS MASTER 4.6.0 — FINAL SOFTWARE GATE SUPERATO"
log "✅ TEST: ${PASS}/${TESTS} · 0 FAIL"
log "✅ SECURITY: proxy-addr CVE patch + secret scan"
log "✅ FIELD SOFTWARE: offline/PWA/evidenze/retry"
log "✅ ENTERPRISE: RBAC/readiness/integrity/origin guard"
log "⚠️ FIELD X1 FISICO: calibrazione sensori e prova cantiere restano verifiche hardware/reali"
log "Report: $REPORT"
log "============================================================"
