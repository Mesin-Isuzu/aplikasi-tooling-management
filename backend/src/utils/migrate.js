const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { pool, withRetry } = require('../config/db');

const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');

async function runMigrations() {
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.split(/\r?\n/).filter(l => !l.trim().startsWith('--')).join('\n').trim())
    .filter(s => s);

  for (const stmt of statements) {
    await pool.query(stmt);
  }
  console.log('[migrate] schema.sql selesai (' + statements.length + ' tabel)');
}

async function migrate() {
  await withRetry(runMigrations, 12, 5000);
}

if (require.main === module) {
  migrate()
    .then(() => { console.log('Migrasi selesai.'); process.exit(0); })
    .catch(err => { console.error('Migrasi gagal:', err); process.exit(1); });
}

module.exports = { migrate, runMigrations };
