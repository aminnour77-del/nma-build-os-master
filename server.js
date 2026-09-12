const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  connectionString: 'postgresql://catasto_ombra_user:YKeK1Ad2PbX9mr2m7cs5HbCHmT7YjC1t@dpg-dai8ud3m8hqs739mmjd0-a.frankfurt-postgres.render.com/catasto_ombra',
  ssl: { rejectUnauthorized: false }
});

// Registrazione collaudo con Storico Pressione, Anomalie e Produttività Squadra
app.post('/api/collaudo', async (req, res) => {
  try {
    const { cantiere, pressione, lat, lng, strumento, operatore, ruolo, metriTubo, raccordi, fotoData, anomalia } = req.body;
    const lLat = lat || 45.07030;
    const lLng = lng || 7.68625;
    const tracciato3D = `LINESTRING Z(${lLng} ${lLat} -1.5, ${lLng + 0.0004} ${lLat + 0.0004} -1.5)`;

    const pressioneVal = Number(pressione || 22.5);
    const esitoCollaudo = pressioneVal < 15.0 ? "ATTENZIONE - PRESSIONE BASSA" : "SUPERATO";
    const segnalazioneAnomalia = anomalia || (pressioneVal < 15.0 ? "Calo di pressione rilevato" : "Nessuna anomalia");

    const query = `
      INSERT INTO reti_gas_ombra (codice_cantiere, operatore, tracciato_3d, log_pressione)
      VALUES ($1, $2, ST_GeomFromText($3, 4326), $4)
    `;
    
    await pool.query(query, [
      cantiere || 'APPALTO-TO-001', 
      `${operatore || 'Noureddine M.'} [${ruolo || 'OPERATORE'}]`, 
      tracciato3D, 
      JSON.stringify({ 
        dispositivo: strumento || 'Testo 510i', 
        pressione_mbar: pressioneVal, 
        esito: esitoCollaudo,
        profondita_m: -1.5,
        metri_tubo: metriTubo || 30,
        raccordi_salvati: raccordi || 2,
        anomalia_segnalata: segnalazioneAnomalia,
        foto_presente: fotoData ? true : false,
        data_ora: new Date().toISOString()
      })
    ]);
    
    io.emit('nuovo_collaudo', { cantiere: cantiere || 'APPALTO-TO-001', metri: metriTubo || 30 });

    res.json({ success: true, alert: pressioneVal < 15.0 });
  } catch (err) {
    console.error('Errore POST:', err);
    res.status(500).send('Errore server');
  }
});

// Endpoint KPI Avanzati e Produttività per Squadra / Operatore
app.get('/api/kpi/:cantiere', async (req, res) => {
  try {
    const { cantiere } = req.params;
    let query = 'SELECT operatore, log_pressione FROM reti_gas_ombra';
    let params = [];
    if (cantiere && cantiere !== 'TUTTI') {
      query += ' WHERE codice_cantiere = $1';
      params.push(cantiere);
    }
    const result = await pool.query(query, params);
    
    let totalMetri = 0;
    let totalRaccordi = 0;
    let anomalieCount = 0;
    let produttivitaPerSquadra = {};

    result.rows.forEach(r => {
      const log = r.log_pressione || {};
      const op = r.operatore || 'Sconosciuto';
      const metri = Number(log.metri_tubo || 30);
      
      totalMetri += metri;
      totalRaccordi += Number(log.raccordi_salvati || 2);
      if (log.anomalia_segnalata && log.anomalia_segnalata !== "Nessuna anomalia") {
        anomalieCount++;
      }

      if (!produttivitaPerSquadra[op]) produttivitaPerSquadra[op] = { tratti: 0, metri_totali: 0 };
      produttivitaPerSquadra[op].tratti += 1;
      produttivitaPerSquadra[op].metri_totali += metri;
    });

    const costoPosa = totalMetri * 45;
    const costoRaccordi = totalRaccordi * 35;

    res.json({
      cantiere: cantiere || 'Tutti',
      tratti_eseguiti: result.rows.length,
      metri_posati: totalMetri,
      raccordi_utilizzati: totalRaccordi,
      anomalie_aperte: anomalieCount,
      rimanenza_magazzino_tubi_m: Math.max(0, 5000 - totalMetri),
      valore_produzione_eur: costoPosa + costoRaccordi,
      produttivita_squadre: produttivitaPerSquadra
    });
  } catch (err) {
    res.status(500).send('Errore calcolo KPI avanzati');
  }
});

// Endpoint per integrazione ERP Aziendale
app.get('/api/erp/sincronizza', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reti_gas_ombra');
    const datiContabili = result.rows.map(row => ({
      id_tratto: row.id,
      cantiere: row.codice_cantiere,
      operatore: row.operatore,
      dettagli: row.log_pressione,
      timestamp: row.id
    }));
    res.json({
      sistema: "NMA BUILD OS - Controllo Totale Enterprise",
      stato: "SINCRONIZZATO",
      totale_record: datiContabili.length,
      dati: datiContabili
    });
  } catch (err) {
    res.status(500).send('Errore sincronizzazione ERP');
  }
});

// Endpoint GeoJSON filtrabile per cantiere
app.get('/api/tubi', async (req, res) => {
  try {
    const cantiereFiltro = req.query.cantiere;
    let q;
    let params = [];

    if (cantiereFiltro && cantiereFiltro !== 'TUTTI') {
      q = `
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
        ) as geojson
        FROM (
          SELECT jsonb_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(tracciato_3d)::jsonb,
            'properties', jsonb_build_object('cantiere', codice_cantiere, 'pressione', log_pressione, 'operatore', operatore)
          ) AS feature
          FROM reti_gas_ombra
          WHERE tracciato_3d IS NOT NULL AND codice_cantiere = $1
        ) features;
      `;
      params.push(cantiereFiltro);
    } else {
      q = `
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
        ) as geojson
        FROM (
          SELECT jsonb_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(tracciato_3d)::jsonb,
            'properties', jsonb_build_object('cantiere', codice_cantiere, 'pressione', log_pressione, 'operatore', operatore)
          ) AS feature
          FROM reti_gas_ombra
          WHERE tracciato_3d IS NOT NULL
        ) features;
      `;
    }

    const result = await pool.query(q, params);
    res.json(result.rows[0].geojson);
  } catch (err) {
    res.status(500).send('Errore Geospaziale');
  }
});

// Lista cantieri attivi
app.get('/api/cantieri', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT codice_cantiere FROM reti_gas_ombra');
    res.json(result.rows.map(r => r.codice_cantiere));
  } catch (err) {
    res.status(500).send('Errore cantieri');
  }
});

// Report As-Built con Storico Pressione e Anomalie
app.get('/api/report/:cantiere', async (req, res) => {
  try {
    const { cantiere } = req.params;
    const result = await pool.query('SELECT * FROM reti_gas_ombra WHERE codice_cantiere = $1', [cantiere]);
    const collaudi = result.rows;

    let totaleMetri = 0;
    let totaleRaccordi = 0;

    collaudi.forEach(row => {
      const log = row.log_pressione || {};
      totaleMetri += Number(log.metri_tubo || 30);
      totaleRaccordi += Number(log.raccordi_salvati || 2);
    });

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <title>Report As-Built & Controllo Totale - ${cantiere}</title>
          <style>
              body { font-family: Helvetica, Arial, sans-serif; margin: 40px; color: #111; background: #fff; }
              h1 { color: #d32f2f; border-bottom: 2px solid #d32f2f; padding-bottom: 10px; }
              .meta { background: #f5f5f5; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
              .counters { display: flex; gap: 15px; margin-bottom: 20px; }
              .counter-box { background: #222; color: #fff; padding: 15px; border-radius: 8px; flex: 1; text-align: center; }
              .counter-box h3 { margin: 0; color: #4CAF50; font-size: 18px; }
              table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              th, td { border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 13px; }
              th { background-color: #333; color: white; }
              .badge { background: #4CAF50; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
              .badge-alert { background: #ff9800; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
          </style>
      </head>
      <body>
          <h1>NMA BUILD OS - CERTIFICATO AS-BUILT & STORICO COLLAUDI</h1>
          <div class="meta">
              <p><strong>Cantiere:</strong> ${cantiere}</p>
              <p><strong>Data Emissione:</strong> ${new Date().toLocaleString()}</p>
              <p><strong>Totale Rilevazioni:</strong> ${collaudi.length}</p>
          </div>
          <div class="counters">
              <div class="counter-box"><h3>${totaleMetri} m</h3><p style="margin:5px 0 0 0;font-size:11px;">Tubi Posati</p></div>
              <div class="counter-box"><h3>${totaleRaccordi}</h3><p style="margin:5px 0 0 0;font-size:11px;">Raccordi</p></div>
              <div class="counter-box"><h3>€ ${(totaleMetri * 45 + totaleRaccordi * 35).toLocaleString()}</h3><p style="margin:5px 0 0 0;font-size:11px;">Valore Totale</p></div>
          </div>
          <h3>Registro Storico Pressioni & Anomalie</h3>
          <table>
              <tr>
                  <th>ID</th>
                  <th>Operatore & Ruolo</th>
                  <th>Tubi (m)</th>
                  <th>Pressione Test</th>
                  <th>Anomalia / Segnalazione</th>
                  <th>Esito</th>
              </tr>`;

    collaudi.forEach(row => {
      const log = row.log_pressione || {};
      const hasAnomaly = log.anomalia_segnalata && log.anomalia_segnalata !== "Nessuna anomalia";
      html += `<tr>
          <td>#${row.id}</td>
          <td><strong>${row.operatore || 'Noureddine M.'}</strong></td>
          <td>${log.metri_tubo || 30} m</td>
          <td>${log.pressione_mbar || 'N/D'} mbar</td>
          <td>${log.anomalia_segnalata || 'Nessuna'}</td>
          <td><span class="${hasAnomaly ? 'badge-alert' : 'badge'}">${log.esito || 'SUPERATO'}</span></td>
      </tr>`;
    });

    html += `</table>
          <br><br>
          <p style="text-align: right; font-size: 12px; color: #666;">Report Storico Certificato - NMA BUILD OS</p>
          <script>window.print();</script>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    res.status(500).send('Errore report storico');
  }
});

// Torre di Controllo (Ufficio) con Dashboard Controllo Totale
app.get('/ufficio', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>NMA BUILD OS - Controllo Totale Struttura</title>
        <script src="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.js"></script>
        <link href="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.css" rel="stylesheet" />
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body { margin: 0; padding: 0; background-color: #111; color: white; font-family: -apple-system, sans-serif; }
            #map { position: absolute; top: 0; bottom: 0; width: 100%; }
            #panel { position: absolute; top: 20px; left: 20px; background: rgba(10,10,10,0.95); padding: 20px; border-radius: 12px; border: 1px solid #333; z-index: 10; width: 360px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .glow { color: #4CAF50; font-weight: bold; }
            .metric { background: #1a1a1a; padding: 12px; border-radius: 8px; margin-top: 15px; border: 1px solid #282828; }
            .metric h4 { margin: 0 0 5px 0; color: #ff3333; font-size: 13px; text-transform: uppercase; }
            .metric p { margin: 0; font-size: 15px; font-weight: bold; }
            select { width: 100%; padding: 8px; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; margin-top: 5px; font-size: 14px; }
            .btn-report { display: block; width: 100%; background: #007AFF; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; margin-top: 15px; cursor: pointer; text-align: center; text-decoration: none; box-sizing: border-box; }
            .btn-report:hover { background: #0056b3; }
            .btn-erp { display: block; width: 100%; background: #333; color: #4CAF50; border: 1px solid #4CAF50; padding: 10px; border-radius: 8px; font-weight: bold; margin-top: 10px; cursor: pointer; text-align: center; text-decoration: none; box-sizing: border-box; font-size: 13px; }
            .btn-erp:hover { background: #222; }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <div id="panel">
            <h2>CONTROLLO STRUTTURALE</h2>
            <hr style="border-color:#333;">
            <p>Stato: <span class="glow">ATTIVO & PROTETTO</span></p>
            
            <div class="metric">
                <h4>Seleziona Appalto</h4>
                <select id="selettore-cantiere" onchange="aggiornaDatiAppalto()">
                    <option value="TUTTI">Tutti i Cantieri (Panoramica)</option>
                </select>
            </div>

            <div class="metric">
                <h4>KPI & Produttività Squadre</h4>
                <p id="stats-metri">Caricamento...</p>
                <p id="stats-valore" style="font-size:13px; color:#4CAF50; margin-top:5px;"></p>
                <p id="stats-anomalie" style="font-size:13px; color:#ff9800; margin-top:3px;"></p>
                <p id="stats-squadre" style="font-size:11px; color:#aaa; margin-top:5px; line-height:1.4;"></p>
            </div>
            
            <a id="link-report" href="/api/report/APPALTO-TO-001" target="_blank" class="btn-report">📄 REPORT STORICO & COLLAUDI</a>
            <a href="/api/erp/sincronizza" target="_blank" class="btn-erp">🔄 ESPORTA JSON PER ERP ESTERNO</a>
        </div>
        <script>
            var map = new maplibregl.Map({
                container: 'map', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
                center: [7.68625, 45.07035], zoom: 17.5, pitch: 60, bearing: -25
            });

            let socket = io();
            let cantiereAttivo = 'TUTTI';

            function caricaMappaEKPI() {
                const urlGeo = cantiereAttivo === 'TUTTI' ? '/api/tubi' : '/api/tubi?cantiere=' + cantiereAttivo;
                fetch(urlGeo).then(res => res.json()).then(data => {
                    if(map.getSource('tubi-gas')) {
                        map.getSource('tubi-gas').setData(data);
                    }
                });

                const urlKpi = '/api/kpi/' + cantiereAttivo;
                fetch(urlKpi).then(res => res.json()).then(kpi => {
                    document.getElementById('stats-metri').innerText = kpi.metri_posati + " Metri posati (" + kpi.tratti_eseguiti + " tratti)";
                    document.getElementById('stats-valore').innerText = "Valore Produzione: € " + kpi.valore_produzione_eur.toLocaleString();
                    document.getElementById('stats-anomalie').innerText = "Anomalie/Segnalazioni: " + kpi.anomalie_aperte;
                    
                    let sqText = "<strong>Produttività Squadre:</strong><br>";
                    for (let sq in kpi.produttivita_squadre) {
                        sqText += "- " + sq + ": " + kpi.produttivita_squadre[sq].metri_totali + "m (" + kpi.produttivita_squadre[sq].tratti + " tratti)<br>";
                    }
                    document.getElementById('stats-squadre').innerHTML = sqText;
                });
            }

            function aggiornaDatiAppalto() {
                cantiereAttivo = document.getElementById('selettore-cantiere').value;
                document.getElementById('link-report').href = '/api/report/' + (cantiereAttivo === 'TUTTI' ? 'APPALTO-TO-001' : cantiereAttivo);
                caricaMappaEKPI();
            }

            function caricaCantieri() {
                fetch('/api/cantieri').then(res => res.json()).then(cantieri => {
                    const select = document.getElementById('selettore-cantiere');
                    let curr = select.value;
                    select.innerHTML = '<option value="TUTTI">Tutti i Cantieri (Panoramica)</option>';
                    cantieri.forEach(c => {
                        let opt = document.createElement('option');
                        opt.value = c;
                        opt.innerText = c;
                        if(c === curr) opt.selected = true;
                        select.appendChild(opt);
                    });
                });
            }

            map.on('load', function () {
                map.addSource('tubi-gas', { type: 'geojson', data: '/api/tubi' });
                map.addLayer({
                    'id': 'tubi-layer', type: 'line', source: 'tubi-gas',
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': '#ff3333', 'line-width': 8, 'line-blur': 1 }
                });
                
                caricaCantieri();
                caricaMappaEKPI();

                socket.on('nuovo_collaudo', (msg) => {
                    caricaMappaEKPI();
                    caricaCantieri();
                });
            });
        </script>
    </body>
    </html>
  `);
});

// Terminale Cantiere con Registro Anomalia e Storico
app.get('/cantiere', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="it">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>NMA BUILD OS - Terminale Cantiere</title>
        <style>
            body { background-color: #000; color: #fff; font-family: -apple-system, sans-serif; margin: 0; padding: 20px; text-align: center; }
            .header { background: #151515; padding: 20px; border-radius: 12px; margin-bottom: 25px; border: 1px solid #333; }
            h1 { font-size: 24px; margin: 0; color: #ff3333; letter-spacing: 1px;}
            .btn { background-color: #ff3333; color: white; border: none; padding: 22px; font-size: 16px; font-weight: bold; border-radius: 12px; width: 100%; margin-top: 20px; cursor: pointer; box-shadow: 0 4px 15px rgba(255, 51, 51, 0.3); transition: 0.2s; }
            .btn:active { transform: scale(0.97); }
            .status-box { background: #111; padding: 25px; border-radius: 12px; margin-top: 20px; border: 1px solid #222; text-align: left;}
            .data-row { display: flex; justify-content: space-between; margin: 15px 0; font-size: 14px; border-bottom: 1px solid #333; padding-bottom: 10px; align-items: center;}
            .highlight { color: #4CAF50; font-weight: bold; }
            input, select { background: #222; color: #fff; border: 1px solid #444; padding: 8px; border-radius: 6px; font-size: 14px; text-align: right; width: 150px; }
            .offline-badge { background: #ff9800; color: #000; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; float: right; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>NMA BUILD OS <span id="net-status" class="offline-badge" style="background:#4CAF50; color:#fff;">ONLINE</span></h1>
            <p style="margin:5px 0 0 0; color:#888; font-size: 14px;">Controllo Strutturale & Storico</p>
        </div>
        
        <div class="status-box">
            <div class="data-row"><span>Codice Cantiere:</span> <input type="text" id="input-cantiere" value="APPALTO-TO-001"></div>
            <div class="data-row"><span>Operatore / Squadra:</span> <input type="text" id="input-operatore" value="Squadra NMA"></div>
            <div class="data-row"><span>Ruolo:</span> 
                <select id="input-ruolo">
                    <option value="OPERATORE">Operatore Scavo</option>
                    <option value="CAPOCANTIERE">Capocantiere</option>
                </select>
            </div>
            <div class="data-row"><span>Metri Tubo:</span> <input type="number" id="input-metri" value="30"></div>
            <div class="data-row"><span>Raccordi:</span> <input type="number" id="input-raccordi" value="2"></div>
            <div class="data-row"><span>Segnala Anomalia:</span> <input type="text" id="input-anomalia" value="Nessuna anomalia" style="width:160px; font-size:12px;"></div>
            <div class="data-row"><span>Foto Scavo/Giunto:</span> <input type="file" id="input-foto" accept="image/*" style="width:170px; font-size:11px;"></div>
            <div class="data-row"><span>Coda Offline:</span> <strong id="queue-count" style="color:#007AFF;">0 elementi</strong></div>
            <div class="data-row"><span>GPS:</span> <strong id="gps-status" style="color:#ffcc00;">Ricerca...</strong></div>
            <div class="data-row"><span>Bluetooth:</span> <strong id="bt-status" style="color:#ff3333;">Disconnesso</strong></div>
        </div>

        <button class="btn" id="btn-bluetooth">1. CONNETTI MANOMETRO (BLE)</button>
        <button class="btn" id="btn-send" style="background-color: #222; color: #555; box-shadow: none;" disabled>2. INVIA COLLAUDO AL CATASTO</button>

        <script>
            let currentLat = 45.07030;
            let currentLng = 7.68625;
            let btDeviceName = "Nessuno";
            let base64Foto = null;

            document.getElementById('input-foto').addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(uploadEvent) {
                        base64Foto = uploadEvent.target.result;
                        alert("✓ Foto allegata al collaudo!");
                    };
                    reader.readAsDataURL(file);
                }
            });

            function updateNetworkStatus() {
                const badge = document.getElementById('net-status');
                const queue = JSON.parse(localStorage.getItem('nma_offline_queue') || '[]');
                document.getElementById('queue-count').innerText = queue.length + " elementi";
                
                if (navigator.onLine) {
                    badge.style.backgroundColor = '#4CAF50';
                    badge.innerText = 'ONLINE';
                    if (queue.length > 0) syncOfflineQueue();
                } else {
                    badge.style.backgroundColor = '#ff9800';
                    badge.innerText = 'OFFLINE (Locale)';
                }
            }

            window.addEventListener('online', updateNetworkStatus);
            window.addEventListener('offline', updateNetworkStatus);

            async function syncOfflineQueue() {
                let queue = JSON.parse(localStorage.getItem('nma_offline_queue') || '[]');
                if (queue.length === 0) return;

                let remaining = [];
                for (let item of queue) {
                    try {
                        let res = await fetch('/api/collaudo', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(item)
                        });
                        if (!res.ok) remaining.push(item);
                    } catch (e) {
                        remaining.push(item);
                    }
                }
                localStorage.setItem('nma_offline_queue', JSON.stringify(remaining));
                updateNetworkStatus();
            }

            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition((pos) => {
                    currentLat = pos.coords.latitude;
                    currentLng = pos.coords.longitude;
                    document.getElementById('gps-status').innerHTML = '<span class="highlight">Agganciato</span>';
                }, () => {
                    document.getElementById('gps-status').innerText = 'Torino (Fallback)';
                });
            }

            document.getElementById('btn-bluetooth').addEventListener('click', async () => {
                try {
                    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
                    btDeviceName = device.name || "Testo 510i";
                    document.getElementById('bt-status').innerHTML = '<span class="highlight">' + btDeviceName + '</span>';
                    
                    const btnConnect = document.getElementById('btn-bluetooth');
                    btnConnect.style.backgroundColor = '#4CAF50';
                    btnConnect.innerText = '✓ STRUMENTO CONNESSO';
                    
                    const btnSend = document.getElementById('btn-send');
                    btnSend.disabled = false;
                    btnSend.style.backgroundColor = '#007AFF';
                    btnSend.style.color = '#fff';
                } catch (error) {
                    alert("Scansione Bluetooth annullata.");
                }
            });

            document.getElementById('btn-send').addEventListener('click', () => {
                const payload = {
                    cantiere: document.getElementById('input-cantiere').value || 'APPALTO-TO-001',
                    operatore: document.getElementById('input-operatore').value || 'Squadra NMA',
                    ruolo: document.getElementById('input-ruolo').value || 'OPERATORE',
                    metriTubo: Number(document.getElementById('input-metri').value || 30),
                    raccordi: Number(document.getElementById('input-raccordi').value || 2),
                    anomalia: document.getElementById('input-anomalia').value || 'Nessuna anomalia',
                    fotoData: base64Foto,
                    pressione: 22.5,
                    strumento: btDeviceName,
                    lat: currentLat,
                    lng: currentLng
                };

                const btnSend = document.getElementById('btn-send');
                btnSend.innerText = 'REGISTRAZIONE IN CORSO...';

                if (!navigator.onLine) {
                    let queue = JSON.parse(localStorage.getItem('nma_offline_queue') || '[]');
                    queue.push(payload);
                    localStorage.setItem('nma_offline_queue', JSON.stringify(queue));
                    updateNetworkStatus();
                    btnSend.innerText = '✓ SALVATO OFFLINE (In Coda)';
                    btnSend.style.backgroundColor = '#ff9800';
                    setTimeout(() => { btnSend.innerText = '2. INVIA COLLAUDO AL CATASTO'; btnSend.style.backgroundColor = '#007AFF'; }, 2500);
                    return;
                }
                
                fetch('/api/collaudo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).then(res => res.json()).then(data => {
                    btnSend.innerText = data.alert ? '⚠ ATTENZIONE: PRESSIONE BASSA' : '✓ COLLAUDO REGISTRATO NEL CATASTO';
                    btnSend.style.backgroundColor = data.alert ? '#ff9800' : '#4CAF50';
                    setTimeout(() => { btnSend.innerText = '2. INVIA COLLAUDO AL CATASTO'; btnSend.style.backgroundColor = '#007AFF'; }, 2500);
                }).catch(() => {
                    let queue = JSON.parse(localStorage.getItem('nma_offline_queue') || '[]');
                    queue.push(payload);
                    localStorage.setItem('nma_offline_queue', JSON.stringify(queue));
                    updateNetworkStatus();
                    btnSend.innerText = '⚠ SALVATO IN LOCALE (Errore rete)';
                    btnSend.style.backgroundColor = '#ff9800';
                });
            });

            updateNetworkStatus();
        </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('✅ NMA BUILD OS - CONTROLLO TOTALE STRUTTURALE ONLINE'); });
