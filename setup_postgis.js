const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://catasto_ombra_user:YKeK1Ad2PbX9mr2m7cs5HbCHmT7YjC1t@dpg-dai8ud3m8hqs739mmjd0-a.frankfurt-postgres.render.com/catasto_ombra',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => {
    console.log('⚙️ Attivazione motore geospaziale 3D in corso...');
    return client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
  })
  .then(() => client.query('SELECT postgis_version();'))
  .then(res => {
    console.log('✅ CATASTO OMBRA OPERATIVO! Versione PostGIS:', res.rows[0].postgis_version);
    client.end();
  })
  .catch(err => {
    console.error('❌ Errore durante l\'attivazione:', err.message);
    client.end();
  });
