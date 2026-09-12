const { Pool } = require('pg');

// Configurazione della connessione al database Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('connect', () => {
  console.log('✅ Connesso al Catasto Ombra Geospaziale');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
