const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://catasto_ombra_user:YKeK1Ad2PbX9mr2m7cs5HbCHmT7YjC1t@dpg-dai8ud3m8hqs739mmjd0-a.frankfurt-postgres.render.com/catasto_ombra',
  ssl: { rejectUnauthorized: false }
});

const createTableQuery = `
  CREATE TABLE IF NOT EXISTS reti_gas_ombra (
    id SERIAL PRIMARY KEY,
    codice_cantiere VARCHAR(100) NOT NULL,
    operatore VARCHAR(100),
    tracciato_3d GEOMETRY(LineStringZ, 4326), 
    log_pressione JSONB, 
    data_posa TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

client.connect()
  .then(() => {
    console.log('🏗️ Costruzione della matrice dati in corso...');
    return client.query(createTableQuery);
  })
  .then(() => {
    console.log('✅ TABELLA "RETI_GAS_OMBRA" CREATA. Il sistema è pronto a ricevere le scansioni dei tubi.');
    client.end();
  })
  .catch(err => {
    console.error('❌ Errore durante la creazione:', err.message);
    client.end();
  });
