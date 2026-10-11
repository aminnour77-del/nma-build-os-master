# NMA BUILD OS MASTER 4.6.0 — FINAL SOFTWARE PRODUCTION GATE

Baseline: 4.5.0 Enterprise Complete verificata.

Questa release chiude il blocco software con:
- patch sicurezza `proxy-addr` 2.0.8 per CVE-2026-90711;
- suite automatica estesa oltre 3.300 test;
- gate RBAC/origin/redaction/session/security headers;
- gate offline/PWA/IndexedDB/evidenze/retry/quota/retention;
- gate Field X1 software: pacchetti sensore, readiness, ATEX stop, materiali e best practice anonime;
- gate integrità Master Shell, frame policy, registry moduli e PWA;
- runtime reale locale con MongoDB, auth 302/401, frame SAMEORIGIN e origin guard;
- `npm audit --audit-level=critical` nel mega collaudo quando il registry npm è raggiungibile.

## Limite dichiarato
Nessun test software può certificare la calibrazione fisica di RTK, LiDAR, termocamera, NFC, alimentazione o comportamento in cantiere. Questi restano gate hardware/reali.
