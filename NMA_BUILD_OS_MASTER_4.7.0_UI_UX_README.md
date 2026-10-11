# NMA BUILD OS MASTER 4.7.0 — Enterprise UI/UX Field Edition

## Architettura di rilascio
- **Core operativo:** 4.6.0, congelato byte-per-byte.
- **UI/UX:** 4.7.0.
- **Logica business / API / MongoDB / workflow / Quality Gate / offline engine:** nessuna modifica.

## Cosa cambia
- navigazione enterprise raggruppata in Operatività, Asset & Digital Twin, Qualità & Controllo, Direzione;
- azioni rapide per Campo, Supervisione, Quality Gate e Passaporto;
- sidebar e topbar ridisegnate con gerarchia più leggibile;
- visual system NMA nero/navy/blu con linee nette e raggi ridotti;
- controlli, tabelle, input e pulsanti ottimizzati per iPad e uso con guanti;
- menu mobile/tablet a drawer;
- focus keyboard, reduced-motion e miglioramenti accessibilità;
- indicatori ONLINE/OFFLINE e metadato UI 4.7.0 / Core 4.6.0;
- styling coerente applicato a tutte le 24 pagine HTML senza introdurre nuove chiamate API.

## Quality gate
Il pacchetto deve superare:
1. hash SHA-256 dei file core 4.6.0;
2. sintassi JS e inline JS di tutte le pagine;
3. intera suite 3.337 test core + 105 test UI/UX;
4. boundary test che vieta networking/persistenza nella nuova UI;
5. secret scan e npm audit critical;
6. runtime MongoDB/auth sul Mac reale quando `.env` è disponibile.

## Regola di rollback
L'installer crea un backup completo del codice prima di installare 4.7.0. Se un gate fallisce, ripristina automaticamente la baseline precedente.
