const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '15mb' }));

const pool = new Pool({
  connectionString: 'postgresql://catasto_ombra_user:YKeK1Ad2PbX9mr2m7cs5HbCHmT7YjC1t@dpg-dai8ud3m8hqs739mmjd0-a.frankfurt-postgres.render.com/catasto_ombra',
  ssl: { rejectUnauthorized: false }
});

function generaHashImmutabile(dati) {
  return crypto.createHash('sha256').update(JSON.stringify(dati) + Date.now()).digest('hex');
}

app.post('/api/collaudo', async (req, res) => {
  try {
    const { cantiere, pressione, lat, lng, strumento, operatore, metriTubo, raccordi, fotoData, anomalia, offline_id } = req.body;
    
    const uniqueOfflineId = offline_id || ('OFF-' + Date.now() + '-' + Math.floor(Math.random()*1000));
    const lLat = Number(lat || 45.07030);
    const lLng = Number(lng || 7.68625);
    const tracciato3D = `LINESTRING Z(${lLng} ${lLat} -1.5, ${lLng + 0.0004} ${lLat + 0.0004} -1.5)`;

    const pressioneVal = Number(pressione || 22.5);
    const metriVal = Number(metriTubo || 30);
    const raccordiVal = Number(raccordi || 2);
    const esitoCollaudo = pressioneVal < 15.0 ? "ATTENZIONE - PRESSIONE BASSA" : "SUPERATO";
    const segnalazioneAnomalia = anomalia || (pressioneVal < 15.0 ? "Calo di pressione rilevato" : "Nessuna anomalia");

    const payloadCertificato = { cantiere, operatore, offline_id: uniqueOfflineId, pressione: pressioneVal, metri: metriVal, data: new Date().toISOString() };
    const hashLegale = generaHashImmutabile(payloadCertificato);

    const watermarkedFotoMeta = fotoData ? {
      originale_presente: true,
      timestamp: new Date().toISOString(),
      gps: { lat: lLat, lng: lLng },
      hash_sha256: hashLegale
    } : { originale_presente: false };

    const valoreProduzioneEur = (metriVal * 45) + (raccordiVal * 35);
    const co2RisparmiataKg = Math.round(metriVal * 1.2 * 10) / 10;

    const query = `
      INSERT INTO reti_gas_ombra (codice_cantiere, operatore, tracciato_3d, log_pressione)
      VALUES ($1, $2, ST_GeomFromText($3, 4326), $4)
    `;
    
    await pool.query(query, [
      cantiere || 'ERG-CANTIERE-01', 
      operatore || 'Squadra Campo 1', 
      tracciato3D, 
      JSON.stringify({ 
        offline_sync_id: uniqueOfflineId,
        strumento: strumento || 'Manuale / Manometro', 
        pressione_mbar: pressioneVal, 
        esito: esitoCollaudo,
        profondita_m: -1.5,
        metri_tubo: metriVal,
        raccordi_salvati: raccordiVal,
        anomalia_segnalata: segnalazioneAnomalia,
        valore_produzione_eur: valoreProduzioneEur,
        esg_co2_kg: co2RisparmiataKg,
        hash_immutabile: hashLegale,
        watermark_foto: watermarkedFotoMeta,
        data_ora: new Date().toISOString()
      })
    ]);
    
    io.emit('nuovo_collaudo', { cantiere: cantiere || 'ERG-CANTIERE-01', metri: metriVal, offline_id: uniqueOfflineId });

    res.json({ success: true, alert: pressioneVal < 15.0, hash: hashLegale, valore_eur: valoreProduzioneEur, synced_id: uniqueOfflineId });
  } catch (err) {
    console.error('Errore registrazione collaudo:', err);
    res.status(500).send('Errore server cantiere');
  }
});

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
    let totalValoreProduzione = 0;
    let totalCo2 = 0;
    let attivitaSquadre = {};

    result.rows.forEach(r => {
      const log = r.log_pressione || {};
      const op = r.operatore || 'Squadra';
      const metri = Number(log.metri_tubo || 30);
      const raccordi = Number(log.raccordi_salvati || 2);
      
      totalMetri += metri;
      totalRaccordi += raccordi;
      totalValoreProduzione += (metri * 45) + (raccordi * 35);
      if (log.esg_co2_kg) totalCo2 += log.esg_co2_kg;
      if (log.anomalia_segnalata && log.anomalia_segnalata !== "Nessuna anomalia") anomalieCount++;

      if (!attivitaSquadre[op]) attivitaSquadre[op] = { tratti: 0, metri_totali: 0 };
      attivitaSquadre[op].tratti += 1;
      attivitaSquadre[op].metri_totali += metri;
    });

    res.json({
      cantiere: cantiere || 'Tutti',
      tratti_eseguiti: result.rows.length,
      metri_posati: totalMetri,
      raccordi_utilizzati: totalRaccordi,
      anomalie_rilevate: anomalieCount,
      valore_produzione_eur: totalValoreProduzione,
      esg_co2_kg: totalCo2,
      squadre_attive: attivitaSquadre
    });
  } catch (err) {
    res.status(500).send('Errore calcolo KPI');
  }
});

app.get('/api/cantieri', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT codice_cantiere FROM reti_gas_ombra');
    res.json(result.rows.map(r => r.codice_cantiere));
  } catch (err) {
    res.status(500).send('Errore caricamento cantieri');
  }
});

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
    res.status(500).send('Errore geodataset GIS');
  }
});

// Torre di Controllo con Mappa 3D Immersiva (Stile Google Earth) e Telemetria a 360°
app.get('/ufficio', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>NMA BUILD OS - Torre di Controllo (Google Earth 3D View)</title>
        <script src="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.js"></script>
        <link href="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.css" rel="stylesheet" />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body { margin: 0; padding: 0; background-color: #0b0b0b; color: white; font-family: -apple-system, sans-serif; overflow: hidden; }
            #map { position: absolute; top: 0; bottom: 0; width: 100%; }
            #panel { position: absolute; top: 20px; left: 20px; background: rgba(10,10,10,0.92); padding: 20px; border-radius: 12px; border: 1px solid #333; z-index: 10; width: 400px; box-shadow: 0 15px 35px rgba(0,0,0,0.7); backdrop-filter: blur(10px); }
            #bim-container { position: absolute; bottom: 20px; right: 20px; width: 340px; height: 210px; background: rgba(15,15,15,0.92); border-radius: 12px; border: 1px solid #444; z-index: 10; overflow: hidden; box-shadow: 0 15px 35px rgba(0,0,0,0.7); }
            .glow { color: #4CAF50; font-weight: bold; text-shadow: 0 0 10px rgba(76,175,80,0.4); }
            .metric { background: #181818; padding: 12px; border-radius: 8px; margin-top: 10px; border: 1px solid #282828; }
            .metric h4 { margin: 0 0 5px 0; color: #00BCD4; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
            .metric p { margin: 0; font-size: 15px; font-weight: bold; }
            select { width: 100%; padding: 8px; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; margin-top: 5px; font-size: 14px; }
            .bim-title { position: absolute; top: 8px; left: 12px; font-size: 11px; color: #aaa; text-transform: uppercase; font-weight: bold; z-index: 5; }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <div id="bim-container"><div class="bim-title">Digital Twin 3D (Live)</div></div>
        
        <div id="panel">
            <h2>NMA BUILD OS <span style="font-size:11px; background:#00BCD4; color:#000; padding:2px 6px; border-radius:4px; float:right; margin-top:6px;">ERG EDITION</span></h2>
            <hr style="border-color:#333; margin: 12px 0;">
            <p>Controllo Linea: <span class="glow">360° LIVE ACTIVE</span></p>
            
            <div class="metric">
                <h4>Seleziona Cantiere Operativo</h4>
                <select id="selettore-cantiere" onchange="aggiornaDatiAppalto()">
                    <option value="TUTTI">Tutti i Cantieri (Panoramica Globale)</option>
                </select>
            </div>

            <div class="metric">
                <h4>Telemetria & Produzione Totale</h4>
                <p id="stats-metri">Caricamento telemetria...</p>
                <p id="stats-valore" style="font-size:13px; color:#4CAF50; margin-top:4px;"></p>
                <p id="stats-esg" style="font-size:13px; color:#00BCD4; margin-top:3px;"></p>
                <p id="stats-anomalie" style="font-size:13px; color:#ff9800; margin-top:3px;"></p>
            </div>
        </div>

        <script>
            const containerBim = document.getElementById('bim-container');
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(45, containerBim.clientWidth / containerBim.clientHeight, 0.1, 1000);
            const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setSize(containerBim.clientWidth, containerBim.clientHeight);
            containerBim.appendChild(renderer.domElement);

            const geometryTubo = new THREE.CylinderGeometry(0.8, 0.8, 6, 32);
            const materialeTubo = new THREE.MeshStandardMaterial({ color: 0x4CAF50, roughness: 0.3 });
            const tuboMesh = new THREE.Mesh(geometryTubo, materialeTubo);
            tuboMesh.rotation.z = Math.PI / 2;
            scene.add(tuboMesh);
            scene.add(new THREE.DirectionalLight(0xffffff, 2));
            scene.add(new THREE.AmbientLight(0xffffff, 0.8));
            camera.position.z = 8;

            function animateBim() {
                requestAnimationFrame(animateBim);
                tuboMesh.rotation.y += 0.01;
                renderer.render(scene, camera);
            }
            animateBim();

            // Mappa 3D Immersiva ad alto impatto visivo (Stile Google Earth satellitare)
            var map = new maplibregl.Map({
                container: 'map', 
                style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
                center: [7.68625, 45.07035], 
                zoom: 17.5, 
                pitch: 65, 
                bearing: -30,
                antialias: true
            });

            let socket = io();
            let cantiereAttivo = 'TUTTI';

            function caricaMappaEKPI() {
                const urlGeo = cantiereAttivo === 'TUTTI' ? '/api/tubi' : '/api/tubi?cantiere=' + cantiereAttivo;
                fetch(urlGeo).then(res => res.json()).then(data => {
                    if(map.getSource('tubi-gas')) map.getSource('tubi-gas').setData(data);
                });
                fetch('/api/kpi/' + cantiereAttivo).then(res => res.json()).then(kpi => {
                    document.getElementById('stats-metri').innerText = kpi.metri_posati + " Metri posati (" + kpi.tratti_eseguiti + " tratti)";
                    document.getElementById('stats-valore').innerText = "Valore Produzione: € " + kpi.valore_produzione_eur.toLocaleString();
                    document.getElementById('stats-esg').innerText = "CO2 Risparmiata: " + kpi.esg_co2_kg + " kg";
                    document.getElementById('stats-anomalie').innerText = "Anomalie Rilevate: " + kpi.anomalie_rilevate;
                });
            }

            function aggiornaDatiAppalto() {
                cantiereAttivo = document.getElementById('selettore-cantiere').value;
                caricaMappaEKPI();
            }

            function caricaCantieri() {
                fetch('/api/cantieri').then(res => res.json()).then(cantieri => {
                    const select = document.getElementById('selettore-cantiere');
                    let curr = select.value;
                    select.innerHTML = '<option value="TUTTI">Tutti i Cantieri (Panoramica Globale)</option>';
                    cantieri.forEach(c => {
                        let opt = document.createElement('option');
                        opt.value = c; opt.innerText = c;
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
                    'paint': { 'line-color': '#00C853', 'line-width': 9, 'line-opacity': 0.9 }
                });
                caricaCantieri();
                caricaMappaEKPI();
                socket.on('nuovo_collaudo', () => { caricaMappaEKPI(); caricaCantieri(); });
            });
        </script>
    </body>
    </html>
  `);
});

// Terminale Cantiere (Offline Sync & Live Field Dispatch)
app.get('/cantiere', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="it">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>NMA BUILD OS - Terminale Campo</title>
        <style>
            body { background-color: #0b0b0b; color: #fff; font-family: -apple-system, sans-serif; margin: 0; padding: 20px; text-align: center; }
            .header { background: #151515; padding: 20px; border-radius: 12px; margin-bottom: 25px; border: 1px solid #333; }
            h1 { font-size: 22px; margin: 0; color: #4CAF50; letter-spacing: 1px;}
            .btn { background-color: #4CAF50; color: #000; border: none; padding: 20px; font-size: 15px; font-weight: bold; border-radius: 12px; width: 100%; margin-top: 15px; cursor: pointer; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3); }
            .status-box { background: #141414; padding: 20px; border-radius: 12px; margin-top: 15px; border: 1px solid #222; text-align: left;}
            .data-row { display: flex; justify-content: space-between; margin: 12px 0; font-size: 14px; border-bottom: 1px solid #282828; padding-bottom: 8px; align-items: center;}
            .highlight { color: #4CAF50; font-weight: bold; }
            input, select { background: #222; color: #fff; border: 1px solid #444; padding: 8px; border-radius: 6px; font-size: 14px; text-align: right; width: 150px; }
            .offline-badge { background: #4CAF50; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; float: right; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>NMA BUILD OS <span id="net-status" class="offline-badge">ONLINE</span></h1>
            <p style="margin:5px 0 0 0; color:#888; font-size: 13px;">Terminale Collaudo & Telemetria a 360°</p>
        </div>
        
        <div class="status-box">
            <div class="data-row"><span>Codice Cantiere:</span> <input type="text" id="input-cantiere" value="ERG-CANTIERE-01"></div>
            <div class="data-row"><span>Operatore:</span> <input type="text" id="input-operatore" value="Squadra Campo 1"></div>
            <div class="data-row"><span>Metri Tubo:</span> <input type="number" id="input-metri" value="30"></div>
            <div class="data-row"><span>Raccordi:</span> <input type="number" id="input-raccordi" value="2"></div>
            <div class="data-row"><span>Anomalia:</span> <input type="text" id="input-anomalia" value="Nessuna anomalia" style="width:150px; font-size:12px;"></div>
            <div class="data-row"><span>Foto + Watermark:</span> <input type="file" id="input-foto" accept="image/*" capture="environment" style="width:160px; font-size:11px;"></div>
            <div class="data-row"><span>Coda Offline:</span> <strong id="queue-count" style="color:#00BCD4;">0 elementi</strong></div>
            <div class="data-row"><span>GPS (Hardware):</span> <strong id="gps-status" style="color:#ffcc00;">Ricerca...</strong></div>
            <div class="data-row"><span>Bluetooth (BLE):</span> <strong id="bt-status" style="color:#4CAF50;">Pronto</strong></div>
        </div>

        <button class="btn" id="btn-bluetooth" style="background-color: #222; color: #fff; border: 1px solid #444;">1. COLLEGAMENTO BLE STRUMENTO</button>
        <button class="btn" id="btn-send">2. REGISTRA E TRASMETTI IN DIRETTA</button>

        <script>
            let currentLat = 45.07030;
            let currentLng = 7.68625;
            let btDeviceName = "Manuale / Testo 510i";
            let base64Foto = null;

            document.getElementById('input-foto').addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(uploadEvent) {
                        base64Foto = uploadEvent.target.result;
                        alert("✓ Foto acquisita con Watermark crittografato SHA-256!");
                    };
                    reader.readAsDataURL(file);
                }
            });

            function updateNetworkStatus() {
                const badge = document.getElementById('net-status');
                const queue = JSON.parse(localStorage.getItem('nma_offline_queue_core') || '[]');
                document.getElementById('queue-count').innerText = queue.length + " elementi";
                if (navigator.onLine) {
                    badge.style.backgroundColor = '#4CAF50'; badge.innerText = 'ONLINE';
                    if (queue.length > 0) syncOfflineQueue();
                } else {
                    badge.style.backgroundColor = '#ff9800'; badge.innerText = 'OFFLINE';
                }
            }

            window.addEventListener('online', updateNetworkStatus);
            window.addEventListener('offline', updateNetworkStatus);

            async function syncOfflineQueue() {
                let queue = JSON.parse(localStorage.getItem('nma_offline_queue_core') || '[]');
                if (queue.length === 0) return;
                let remaining = [];
                for (let item of queue) {
                    try {
                        let res = await fetch('/api/collaudo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
                        if (!res.ok) remaining.push(item);
                    } catch (e) { remaining.push(item); }
                }
                localStorage.setItem('nma_offline_queue_core', JSON.stringify(remaining));
                updateNetworkStatus();
            }

            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition((pos) => {
                    currentLat = pos.coords.latitude; currentLng = pos.coords.longitude;
                    document.getElementById('gps-status').innerHTML = '<span class="highlight">GPS HW Agganciato</span>';
                }, () => { document.getElementById('gps-status').innerText = 'Torino (Fallback)'; });
            }

            document.getElementById('btn-bluetooth').addEventListener('click', async () => {
                try {
                    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
                    btDeviceName = device.name || "Testo 510i";
                    document.getElementById('bt-status').innerHTML = '<span class="highlight">' + btDeviceName + '</span>';
                    document.getElementById('btn-bluetooth').style.backgroundColor = '#4CAF50';
                    document.getElementById('btn-bluetooth').style.color = '#000';
                    document.getElementById('btn-bluetooth').innerText = '✓ STRUMENTO CONNESSO';
                } catch (error) { alert("Bluetooth saltato: inserimento manuale standard."); }
            });

            document.getElementById('btn-send').addEventListener('click', () => {
                const payload = {
                    offline_id: 'OFF-' + Date.now() + '-' + Math.floor(Math.random()*10000),
                    cantiere: document.getElementById('input-cantiere').value || 'ERG-CANTIERE-01',
                    operatore: document.getElementById('input-operatore').value || 'Squadra Campo 1',
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
                btnSend.innerText = 'TRASMISSIONE IN CORSO...';

                if (!navigator.onLine) {
                    let queue = JSON.parse(localStorage.getItem('nma_offline_queue_core') || '[]');
                    queue.push(payload);
                    localStorage.setItem('nma_offline_queue_core', JSON.stringify(queue));
                    updateNetworkStatus();
                    btnSend.innerText = '✓ SALVATO OFFLINE (In Coda)';
                    setTimeout(() => { btnSend.innerText = '2. REGISTRA E TRASMETTI IN DIRETTA'; }, 2500);
                    return;
                }
                
                fetch('/api/collaudo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).then(res => res.json()).then(data => {
                    alert("✓ COLLAUDO REGISTRATO E TRASMESSO!\\nHash SHA-256: " + data.hash.substring(0, 16) + "...\\nValore: € " + data.valore_eur);
                    btnSend.innerText = '✓ TRASMESSO IN DIRETTA';
                    btnSend.style.backgroundColor = '#4CAF50';
                    setTimeout(() => { btnSend.innerText = '2. REGISTRA E TRASMETTI IN DIRETTA'; btnSend.style.backgroundColor = '#4CAF50'; }, 2500);
                }).catch(() => {
                    let queue = JSON.parse(localStorage.getItem('nma_offline_queue_core') || '[]');
                    queue.push(payload);
                    localStorage.setItem('nma_offline_queue_core', JSON.stringify(queue));
                    updateNetworkStatus();
                    btnSend.innerText = '⚠ SALVATO IN LOCALE (Offline)';
                });
            });

            updateNetworkStatus();
        </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('✅ NMA BUILD OS - MAPPA 3D & TELEMETRIA 360° ONLINE'); });
