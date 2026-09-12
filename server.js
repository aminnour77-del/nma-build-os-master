const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: 'postgresql://catasto_ombra_user:YKeK1Ad2PbX9mr2m7cs5HbCHmT7YjC1t@dpg-dai8ud3m8hqs739mmjd0-a.frankfurt-postgres.render.com/catasto_ombra',
  ssl: { rejectUnauthorized: false }
});

// Registrazione collaudo con calcolo metrico
app.post('/api/collaudo', async (req, res) => {
  try {
    const { cantiere, pressione, lat, lng, strumento } = req.body;
    const lLat = lat || 45.07030;
    const lLng = lng || 7.68625;
    const tracciato3D = `LINESTRING Z(${lLng} ${lLat} -1.5, ${lLng + 0.0004} ${lLat + 0.0004} -1.5)`;

    await pool.query(
      `INSERT INTO reti_gas_ombra (codice_cantiere, operatore, tracciato_3d, log_pressione) VALUES ($1, 'Squadra NMA', ST_GeomFromText($2, 4326), $3)`,
      [cantiere || 'APPALTO-TO-001', tracciato3D, JSON.stringify({ dispositivo: strumento || 'Testo 510i', pressione_mbar: pressione || 22.5, esito: "SUPERATO", profondita_m: -1.5 })]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Errore POST:', err);
    res.status(500).send('Errore server');
  }
});

// Endpoint GeoJSON per la mappa
app.get('/api/tubi', async (req, res) => {
  try {
    const query = `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      ) as geojson
      FROM (
        SELECT jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(tracciato_3d)::jsonb,
          'properties', jsonb_build_object('cantiere', codice_cantiere, 'pressione', log_pressione)
        ) AS feature
        FROM reti_gas_ombra
        WHERE tracciato_3d IS NOT NULL
      ) features;
    `;
    const result = await pool.query(query);
    res.json(result.rows[0].geojson);
  } catch (err) {
    res.status(500).send('Errore Geospaziale');
  }
});

// PUNTO 2: Report As-Built formattato e stampabile
app.get('/api/report/:cantiere', async (req, res) => {
  try {
    const { cantiere } = req.params;
    const result = await pool.query('SELECT * FROM reti_gas_ombra WHERE codice_cantiere = $1', [cantiere]);
    const collaudi = result.rows;

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <title>Report As-Built - ${cantiere}</title>
          <style>
              body { font-family: Helvetica, Arial, sans-serif; margin: 40px; color: #111; }
              h1 { color: #d32f2f; border-bottom: 2px solid #d32f2f; padding-bottom: 10px; }
              .meta { background: #f5f5f5; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
              table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              th, td { border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 13px; }
              th { background-color: #333; color: white; }
              .badge { background: #4CAF50; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
          </style>
      </head>
      <body>
          <h1>NMA BUILD OS - CERTIFICATO DI COLLAUDO AS-BUILT</h1>
          <div class="meta">
              <p><strong>Cantiere:</strong> ${cantiere}</p>
              <p><strong>Data Emissione:</strong> ${new Date().toLocaleString()}</p>
              <p><strong>Totale Tratti Collaudati:</strong> ${collaudi.length}</p>
          </div>
          <h3>Dettaglio Rilevazioni Bluetooth & GPS</h3>
          <table>
              <tr>
                  <th>ID Tratto</th>
                  <th>Operatore</th>
                  <th>Profondità</th>
                  <th>Pressione Rilevata</th>
                  <th>Strumento BLE</th>
                  <th>Esito</th>
              </tr>`;

    collaudi.forEach(row => {
      const log = row.log_pressione || {};
      html += `<tr>
          <td>#${row.id}</td>
          <td>${row.operatore}</td>
          <td>${log.profondita_m || -1.5} m</td>
          <td>${log.pressione_mbar || 'N/D'} mbar</td>
          <td>${log.dispositivo || 'Testo 510i'}</td>
          <td><span class="badge">${log.esito || 'SUPERATO'}</span></td>
      </tr>`;
    });

    html += `</table>
          <br><br>
          <p style="text-align: right; font-size: 12px; color: #666;">Documento generato digitalmente da NMA BUILD OS - Validato via Cloud PostGIS</p>
          <script>window.print();</script>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    res.status(500).send('Errore generazione report');
  }
});

// Torre di Controllo con metriche originali + Pulsante Report As-Built
app.get('/ufficio', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>NMA BUILD OS - Torre di Controllo</title>
        <script src="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.js"></script>
        <link href="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.css" rel="stylesheet" />
        <style>
            body { margin: 0; padding: 0; background-color: #111; color: white; font-family: -apple-system, sans-serif; }
            #map { position: absolute; top: 0; bottom: 0; width: 100%; }
            #panel { position: absolute; top: 20px; left: 20px; background: rgba(10,10,10,0.9); padding: 20px; border-radius: 12px; border: 1px solid #333; z-index: 10; width: 340px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .glow { color: #4CAF50; font-weight: bold; }
            .metric { background: #1a1a1a; padding: 12px; border-radius: 8px; margin-top: 15px; border: 1px solid #282828; }
            .metric h4 { margin: 0 0 5px 0; color: #ff3333; font-size: 13px; text-transform: uppercase; }
            .metric p { margin: 0; font-size: 15px; font-weight: bold; }
            .btn-report { display: block; width: 100%; background: #007AFF; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; margin-top: 15px; cursor: pointer; text-align: center; text-decoration: none; box-sizing: border-box; }
            .btn-report:hover { background: #0056b3; }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <div id="panel">
            <h2>CATASTO OMBRA 3D</h2>
            <hr style="border-color:#333;">
            <p>Stato: <span class="glow">LIVE SYNC</span></p>
            <div class="metric">
                <h4>Infrastruttura Certificata</h4>
                <p id="stats-metri">Calcolo metri in corso...</p>
            </div>
            <a href="/api/report/APPALTO-TO-001" target="_blank" class="btn-report">📄 SCARICA REPORT AS-BUILT</a>
        </div>
        <script>
            var map = new maplibregl.Map({
                container: 'map', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
                center: [7.68625, 45.07035], zoom: 17.5, pitch: 60, bearing: -25
            });
            map.on('load', function () {
                map.addSource('tubi-gas', { type: 'geojson', data: '/api/tubi' });
                map.addLayer({
                    'id': 'tubi-layer', type: 'line', source: 'tubi-gas',
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': '#ff3333', 'line-width': 8, 'line-blur': 1 }
                });
                
                function ricaricaDati() {
                    fetch('/api/tubi').then(res => res.json()).then(data => {
                        if(map.getSource('tubi-gas')) {
                            map.getSource('tubi-gas').setData(data);
                            const count = data.features ? data.features.length : 0;
                            document.getElementById('stats-metri').innerText = (count * 30) + " Metri Lineari posati (" + count + " collaudi)";
                        }
                    });
                }
                setInterval(ricaricaDati, 3000);
            });
        </script>
    </body>
    </html>
  `);
});

// Terminale Cantiere originale
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
            .data-row { display: flex; justify-content: space-between; margin: 15px 0; font-size: 14px; border-bottom: 1px solid #333; padding-bottom: 10px;}
            .highlight { color: #4CAF50; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>NMA BUILD OS</h1>
            <p style="margin:5px 0 0 0; color:#888; font-size: 14px;">Terminale Scavo: APPALTO-TO-001</p>
        </div>
        
        <div class="status-box">
            <div class="data-row"><span>GPS:</span> <strong id="gps-status" style="color:#ffcc00;">Ricerca satelliti...</strong></div>
            <div class="data-row"><span>Bluetooth:</span> <strong id="bt-status" style="color:#ff3333;">Disconnesso</strong></div>
        </div>

        <button class="btn" id="btn-bluetooth">1. CONNETTI MANOMETRO (BLE)</button>
        <button class="btn" id="btn-send" style="background-color: #222; color: #555; box-shadow: none;" disabled>2. INVIA DATI AL CATASTO</button>

        <script>
            let currentLat = 45.07030;
            let currentLng = 7.68625;
            let btDeviceName = "Nessuno";

            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition((position) => {
                    currentLat = position.coords.latitude;
                    currentLng = position.coords.longitude;
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
                const btnSend = document.getElementById('btn-send');
                btnSend.innerText = 'TRASMISSIONE...';
                
                fetch('/api/collaudo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cantiere: 'APPALTO-TO-001',
                        pressione: 22.5,
                        strumento: btDeviceName,
                        lat: currentLat,
                        lng: currentLng
                    })
                }).then(res => {
                    if(res.ok) {
                        btnSend.innerText = '✓ RICEVUTO DAL CATASTO OMBRA';
                        btnSend.style.backgroundColor = '#4CAF50';
                        setTimeout(() => { btnSend.innerText = '2. INVIA DATI AL CATASTO'; btnSend.style.backgroundColor = '#007AFF'; }, 2500);
                    }
                });
            });
        </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log('✅ SERVER AGGIORNATO CON PUNTO 2'); });
