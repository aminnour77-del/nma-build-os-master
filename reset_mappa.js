const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://catasto_ombra_user:YKeK1Ad2PbX9mr2m7cs5HbCHmT7YjC1t@dpg-dai8ud3m8hqs739mmjd0-a.frankfurt-postgres.render.com/catasto_ombra',
  ssl: { rejectUnauthorized: false }
});

async function resetDatabase() {
  try {
    console.log('⏳ Collegamento al Catasto Ombra in corso...');
    // TRUNCATE svuota completamente la tabella all'istante
    await pool.query('TRUNCATE TABLE reti_gas_ombra;');
    console.log('✅ MAPPA RIPULITA! Tutti i tubi di test sono stati eliminati definitivamente.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Errore durante la pulizia:', err);
    process.exit(1);
  }
}

resetDatabase();
