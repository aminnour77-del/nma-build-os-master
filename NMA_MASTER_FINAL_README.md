# NMA BUILD OS MASTER — FINAL CONTROL ROOM

Questo pacchetto non costruisce un altro prototipo separato: si installa sopra una baseline Git verificata e mantiene i moduli operativi già presenti.

## Baseline
L'installer usa in ordine:
1. `build-os-master-candidate-v1.0.0` se presente;
2. altrimenti `build-os-master-rc1`.

## Cosa installa
- nuova `master_control_v1.html` in stile Control Room della reference;
- `nma_master_final.js`, modulo Express read-only per dashboard;
- endpoint dashboard che leggono i model MongoDB già registrati;
- collegamenti ai moduli Campo, Supervisione, Workflow, Quality, Audit, Passaporto, Asset Memory, Network Memory, Spatial Twin, Control Room, Command Center, SAL e confronto As-Built;
- smoke test locale.

## Principio dati
La dashboard non inventa geometrie o KPI. Se il database non contiene una geometria, la mappa mostra la base satellitare e indica che non ci sono tratti GIS reali disponibili.

## Installazione
```bash
unzip -o ~/Downloads/NMA_BUILD_OS_MASTER_FINAL_PACKAGE.zip -d ~/Desktop/NMA_BUILD_OS_MASTER_FINAL_PACKAGE
/bin/bash ~/Desktop/NMA_BUILD_OS_MASTER_FINAL_PACKAGE/NMA_BUILD_OS_MASTER_FINAL_INSTALL.sh
```

## Test
```bash
/bin/bash ~/Desktop/nma-build-os-master-sync/NMA_BUILD_OS_MASTER_FINAL_TEST.sh
```

Poi apri `http://localhost:3001/master`.

## Limite del test consegnato
I controlli inclusi verificano sintassi, struttura, dipendenze, avvio HTTP e collegamento dei file. MongoDB Atlas reale, sessione reale, rendering Safari/iPhone e GPS fisico vengono validati sul tuo Mac perché richiedono i tuoi segreti e il tuo ambiente.
