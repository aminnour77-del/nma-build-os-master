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
    const { cantiere, pressione, lat, lng } = req.body;
    
    // Calcoliamo la lunghezza del tubo direttamente in Node.js
    const endLat = lat + 0.0004;
    const endLng = lng + 0.0004;
    const tracciato3D = `LINESTRING Z(${lng} ${lat} -1.5, ${endLng} ${endLat} -1.5)`;

    const query = `
      INSERT INTO reti_gas_ombra (codice_cantiere, operatore, tracciato_3d, log_pressione)
      VALUES ($1, 'Squadra NMA', ST_GeomFromText($2, 4326), $3)
    `;
    
    await pool.query(query, [
      cantiere, 
      tracciato3D, 
      JSON.stringify({ dispositivo: "Testo 510i", pressione_mbar: pressione, esito: "SUPERATO" })
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
    console.error('Errore GET:', err);
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
                setInterval(() => { map.getSource('tubi-gas').setData('/api/tubi'); }, 3000);
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Terminale Cantiere</title>
        <style>
            body { background: #000; color: #fff; font-family: -apple-system, sans-serif; padding: 20px; text-align: center; }
            .btn { background: #ff3333; color: white; border: none; padding: 22px; font-size: 16px; font-weight: bold; border-radius: 12px; width: 100%; margin-top: 40px; cursor: pointer; transition: 0.3s; }
        </style>
    </head>
    <body>
        <h2 style="color: #ff3333;">NMA BUILD OS</h2>
        <p>Terminale Scavo: <strong>APPALTO-TO-001</strong></p>
        <button class="btn" id="btn-invia">SIMULA COLLAUDO BLE E INVIA</button>
        <script>
            document.getElementById('btn-invia').addEventListener('click', () => {
                const btn = document.getElementById('btn-invia');
                btn.innerText = 'TRASMISSIONE...';
                btn.style.background = '#007AFF';
                
                fetch('/api/collaudo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cantiere: 'APPALTO-TO-001',
                        pressione: 22.5,
                        lat: 45.07000 + (Math.random() * 0.0010),
                        lng: 7.68550 + (Math.random() * 0.0015)
                    })
                }).then(res => {
                    if(res.ok) {
                        btn.innerText = '✓ RICEVUTO DAL CATASTO OMBRA';
                        btn.style.background = '#4CAF50';
                    } else {
                        btn.innerText = '❌ ERRORE SERVER';
                        btn.style.background = 'red';
                    }
                    setTimeout(() => { btn.innerText = 'SIMULA NUOVO COLLAUDO'; btn.style.background = '#ff3333'; }, 1500);
                });
            });
        </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('✅ SERVER CORRETTO E ONLINE SULLA PORTA ' + PORT);
});
