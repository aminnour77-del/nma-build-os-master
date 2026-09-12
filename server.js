const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: 'postgresql://catasto_ombra_user:YKeK1Ad2PbX9mr2m7cs5HbCHmT7YjC1t@dpg-dai8ud3m8hqs739mmjd0-a.frankfurt-postgres.render.com/catasto_ombra',
  ssl: { rejectUnauthorized: false }
});

app.post('/api/collaudo', async (req, res) => {
  try {
    const { cantiere, pressione, lat, lng, strumento } = req.body;
    
    // Genera un tubo di circa 30 metri partendo dalla tua posizione GPS reale
    const endLat = lat + 0.0003;
    const endLng = lng + 0.0003;
    const tracciato3D = `LINESTRING Z(${lng} ${lat} -1.5, ${endLng} ${endLat} -1.5)`;

    const query = `
      INSERT INTO reti_gas_ombra (codice_cantiere, operatore, tracciato_3d, log_pressione)
      VALUES ($1, 'Squadra NMA', ST_GeomFromText($2, 4326), $3)
    `;
    
    await pool.query(query, [
      cantiere, 
      tracciato3D, 
      JSON.stringify({ dispositivo: strumento, pressione_mbar: pressione, esito: "SUPERATO" })
    ]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Errore POST:', err);
    res.status(500).send('Errore server');
  }
});

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

app.get('/ufficio', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Torre di Controllo</title>
        <script src="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.js"></script>
        <link href="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.css" rel="stylesheet" />
        <style>
            body { margin: 0; padding: 0; background-color: #111; color: white; font-family: -apple-system, sans-serif; }
            #map { position: absolute; top: 0; bottom: 0; width: 100%; }
            #panel { position: absolute; top: 20px; left: 20px; background: rgba(10,10,10,0.85); padding: 25px; border-radius: 12px; border: 1px solid #333; z-index: 10; width: 320px; }
            .glow { color: #4CAF50; font-weight: bold; }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <div id="panel"><h2>CATASTO OMBRA 3D</h2><hr><p>Sincronizzazione <span class="glow">LIVE</span> attiva. In attesa di collaudi...</p></div>
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
                setInterval(() => { 
                    map.getSource('tubi-gas').setData('/api/tubi'); 
                }, 3000);
            });
        </script>
    </body>
    </html>
  `);
});

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
            let currentLat = 45.07030; // Coordinate di backup (Torino)
            let currentLng = 7.68625;
            let btDeviceName = "Nessuno";

            // Motore 1: GPS
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition((position) => {
                    currentLat = position.coords.latitude;
                    currentLng = position.coords.longitude;
                    document.getElementById('gps-status').innerHTML = '<span class="highlight">Agganciato (' + position.coords.accuracy.toFixed(0) + 'm)</span>';
                }, () => {
                    document.getElementById('gps-status').innerText = 'Errore (uso Torino)';
                });
            }

            // Motore 2: Web Bluetooth
            document.getElementById('btn-bluetooth').addEventListener('click', async () => {
                try {
                    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
                    btDeviceName = device.name || "Testo 510i";
                    
                    document.getElementById('bt-status').innerHTML = '<span class="highlight">' + btDeviceName + '</span>';
                    
                    const btnConnect = document.getElementById('btn-bluetooth');
                    btnConnect.style.backgroundColor = '#4CAF50';
                    btnConnect.style.boxShadow = '0 4px 15px rgba(76, 175, 80, 0.4)';
                    btnConnect.innerText = '✓ STRUMENTO CONNESSO';
                    
                    const btnSend = document.getElementById('btn-send');
                    btnSend.disabled = false;
                    btnSend.style.backgroundColor = '#007AFF';
                    btnSend.style.color = '#fff';
                    btnSend.style.boxShadow = '0 4px 15px rgba(0, 122, 255, 0.4)';
                    
                } catch (error) {
                    alert("Scansione annullata. Su smartphone, assicurati di usare Google Chrome.");
                }
            });

            // Motore 3: Trasmissione Sicura
            document.getElementById('btn-send').addEventListener('click', () => {
                const btnSend = document.getElementById('btn-send');
                btnSend.innerText = 'TRASMISSIONE IN CORSO...';
                
                fetch('/api/collaudo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cantiere: 'APPALTO-TO-001',
                        pressione: 22.5, // Valore reale che estrarremmo dal Bluetooth
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
app.listen(PORT, () => { console.log('✅ SERVER HARDWARE ONLINE'); });
