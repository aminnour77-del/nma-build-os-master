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
    const lLat = lat || 45.07030;
    const lLng = lng || 7.68625;
    const tracciato3D = `LINESTRING Z(${lLng} ${lLat} -1.5, ${lLng + 0.0004} ${lLat + 0.0004} -1.5)`;

    await pool.query(
      `INSERT INTO reti_gas_ombra (codice_cantiere, operatore, tracciato_3d, log_pressione) VALUES ($1, 'Squadra NMA', ST_GeomFromText($2, 4326), $3)`,
      [cantiere || 'APPALTO-TO-001', tracciato3D, JSON.stringify({ dispositivo: strumento || 'Testo 510i', pressione_mbar: pressione || 22.5, esito: "SUPERATO" })]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore');
  }
});

app.get('/api/tubi', async (req, res) => {
  try {
    const q = `SELECT jsonb_build_object('type', 'FeatureCollection', 'features', COALESCE(jsonb_agg(jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(tracciato_3d)::jsonb, 'properties', jsonb_build_object('cantiere', codice_cantiere, 'pressione', log_pressione))), '[]'::jsonb)) as geojson FROM reti_gas_ombra WHERE tracciato_3d IS NOT NULL`;
    const result = await pool.query(q);
    res.json(result.rows[0].geojson);
  } catch (err) {
    res.status(500).send('Errore');
  }
});

app.get('/ufficio', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Torre di Controllo</title><script src="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.js"></script><link href="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.css" rel="stylesheet" /><style>body{margin:0;background:#111;color:#fff;font-family:sans-serif;}#map{position:absolute;top:0;bottom:0;width:100%;}#panel{position:absolute;top:20px;left:20px;background:rgba(10,10,10,0.9);padding:20px;border-radius:12px;z-index:10;width:280px;border:1px solid #333;}</style></head><body><div id="map"></div><div id="panel"><h2>CATASTO OMBRA</h2><p>Stato: <span style="color:#4CAF50">LIVE SYNC</span></p></div><script>var map=new maplibregl.Map({container:'map',style:'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',center:[7.68625,45.07035],zoom:17.5,pitch:60});map.on('load',function(){map.addSource('t',{type:'geojson',data:'/api/tubi'});map.addLayer({'id':'l','type':'line','source':'t','paint':{'line-color':'#ff3333','line-width':8}});setInterval(()=>{map.getSource('t').setData('/api/tubi');},3000);});</script></body></html>`);
});

app.get('/cantiere', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Cantiere</title><style>body{background:#000;color:#fff;font-family:sans-serif;padding:20px;text-align:center;}input,button{width:100%;padding:20px;margin-top:15px;font-size:16px;border-radius:10px;border:none;}input{background:#222;color:#fff;text-align:center;}button{background:#ff3333;color:#fff;font-weight:bold;}</style></head><body><h2>TERMINALE CANTIERE</h2><input id="c" value="APPALTO-TO-001"><button onclick="send()">INVIA COLLAUDO</button><script>function send(){fetch('/api/collaudo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cantiere:document.getElementById('c').value,pressione:22.5,lat:45.0703,lng:7.68625,strumento:'Testo 510i'})}).then(r=>{if(r.ok)alert('Inviato con successo al Catasto!');});}</script></body></html>`);
});

app.listen(process.env.PORT || 3000, () => { console.log('Base pulita online'); });
