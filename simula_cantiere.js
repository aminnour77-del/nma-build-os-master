const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://catasto_ombra_user:YKeK1Ad2PbX9mr2m7cs5HbCHmT7YjC1t@dpg-dai8ud3m8hqs739mmjd0-a.frankfurt-postgres.render.com/catasto_ombra',
  ssl: { rejectUnauthorized: false }
});

const insertQuery = `
  INSERT INTO reti_gas_ombra (codice_cantiere, operatore, tracciato_3d, log_pressione)
  VALUES (
    'APPALTO-TO-001',
    'Squadra NMA',
    ST_GeomFromText('LINESTRING Z(7.68612 45.07031 -1.5, 7.68625 45.07035 -1.5, 7.68640 45.07040 -1.6)', 4326),
    '{"dispositivo": "Testo 510i", "pressione_mbar": 22.5, "esito": "SUPERATO"}'
  ) RETURNING id;
`;

client.connect()
  .then(() => {
    console.log('📡 Trasmissione dati cantiere in corso...');
    return client.query(insertQuery);
  })
  .then(res => {
    console.log(`✅ SUCCESSO! Tubo virtuale posato nel Catasto Ombra. ID Record: ${res.rows[0].id}`);
    client.end();
  })
  .catch(err => {
    console.error('❌ Errore di trasmissione:', err.message);
    client.end();
  });
