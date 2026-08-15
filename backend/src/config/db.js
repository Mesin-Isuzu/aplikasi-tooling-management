const mysql = require('mysql2/promise');

function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: (u.pathname || '').replace(/^\//, '')
  };
}

function buildConfig() {
  if (process.env.DATABASE_URL) {
    return parseDbUrl(process.env.DATABASE_URL);
  }
  if (process.env.MYSQL_URL) {
    return parseDbUrl(process.env.MYSQL_URL);
  }
  return {
    host: process.env.MYSQL_HOST || process.env.MYSQLHOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.MYSQL_USER || process.env.MYSQLUSER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || 'dtms'
  };
}

const dbConfig = {
  ...buildConfig(),
  charset: 'utf8mb4',
  multipleStatements: true,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

async function withRetry(fn, attempts = 12, delayMs = 5000) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error(`[db] percobaan ${i + 1}/${attempts} gagal: ${err.code || err.message}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { pool, query, withRetry, dbConfig };
