# NMA BUILD OS MASTER 4.5.0 — ENTERPRISE COMPLETE

Baseline: 4.4.2 verificata su Mac + MongoDB Atlas + Render.

## Aggiunte 4.5.0
- PWA Campo con Service Worker e riapertura offline del Terminale Campo dopo il primo accesso online.
- Evidenze foto/PDF salvate in IndexedDB quando offline o in caso di errore rete temporaneo.
- Sync automatico evidenze con SHA-256/idempotenza server già esistente.
- Limiti locali: 15 MB/file, 100 file, 250 MB, soft quota browser 80%.
- Retry con backoff, stato coda e badge ONLINE/OFFLINE.
- Readiness/liveness enterprise, telemetria runtime, integrità SHA-256 dei file core.
- Export amministrativo JSON per singola collection, con redazione campi sensibili.
- Request ID e protezione same-origin per API mutative.
- Graceful shutdown per Render/container.
- Enterprise Control dashboard.

## Limite fisico
La piattaforma software è pronta per pilot/produzione controllata. Precisione RTK/LiDAR/termica e idoneità ATEX dipendono dall'hardware reale, dalla calibrazione e dalle autorizzazioni HSE.
