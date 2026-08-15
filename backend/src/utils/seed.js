// Seed MySQL dari js/data.js (hanya jika tabel users kosong)
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const vm = require('vm');
const bcrypt = require('bcryptjs');
const { pool, withRetry } = require('../config/db');

const dataPath = path.join(__dirname, '..', '..', '..', 'js', 'data.js');
const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || 'password';

const supplierMap = {
  'PT Auto Parts': 'SUP001',
  'PT Plasticindo': 'SUP002',
  'PT Metalindo': 'SUP003'
};

function loadMockData() {
  const code = fs.readFileSync(dataPath, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'data.js' });
  return sandbox.window.dtmsData;
}

async function insertRows(conn, table, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const colSql = columns.map(c => '`' + c + '`').join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO \`${table}\` (${colSql}) VALUES (${placeholders})`;
  for (const row of rows) {
    await conn.query(sql, columns.map(c => row[c]));
  }
}

async function seed() {
  const d = loadMockData();
  const passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM `users`');
  if (n > 0) {
    console.log('[seed] users sudah ada (' + n + ') — seed dilewati.');
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const users = d.users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email || `${u.username}@dtms.mail`,
      passwordHash,
      role: u.role,
      name: u.name,
      company: u.company || null,
      supplierId: u.supplierId || null
    }));
    await insertRows(conn, 'users', users);

    const toolings = d.toolings.map(t => {
      const { paDocumentData, drawingDiesData, ...rest } = t;
      return {
        ...rest,
        supplierId: supplierMap[t.supplier] || null,
        paDocumentPath: null,
        drawingDiesPath: null
      };
    });
    await insertRows(conn, 'toolings', toolings);

    const maintenanceLogs = d.maintenanceLogs.map(m => ({
      id: m.id, toolId: m.toolId, toolName: m.toolName, dateStart: m.dateStart,
      dateEnd: m.dateEnd, type: m.type, description: m.description, status: m.status,
      evidence: m.evidence || null, evidencePath: null, requestedBy: m.requestedBy, cost: m.cost
    }));
    await insertRows(conn, 'maintenanceLogs', maintenanceLogs);

    const supplierTasks = d.supplierTasks.map(t => ({
      id: t.id, toolId: t.toolId, toolName: t.toolName, supplier: t.supplier,
      supplierId: supplierMap[t.supplier] || null, type: t.type, description: t.description,
      assignedDate: t.assignedDate, dueDate: t.dueDate, status: t.status,
      priority: t.priority, completedDate: t.completedDate, evidence: t.evidence || null,
      evidencePath: null
    }));
    await insertRows(conn, 'supplierTasks', supplierTasks);

    const shootLogs = d.shootLogs.map(s => ({
      id: s.id, toolId: s.toolId, month: s.month, inputDate: s.inputDate, shootCount: s.shootCount
    }));
    await insertRows(conn, 'shootLogs', shootLogs);

    if (d.productionLogs && d.productionLogs.length) {
      const productionLogs = d.productionLogs.map(p => ({
        id: p.id, toolId: p.toolId, shootLogId: p.shootLogId, actualPartOk: p.actualPartOk
      }));
      await insertRows(conn, 'productionLogs', productionLogs);
    }

    const deliveryLogs = d.deliveryLogs.map(x => ({
      id: x.id, toolId: x.toolId, month: x.month, inputDate: x.inputDate,
      qtyDelivered: x.qtyDelivered, qtyOk: x.qtyOk
    }));
    await insertRows(conn, 'deliveryLogs', deliveryLogs);

    const movementLogs = d.movementLogs.map(m => ({
      id: m.id, toolId: m.toolId, toolName: m.toolName, fromLocation: m.fromLocation,
      toLocation: m.toLocation, date: m.date, reason: m.reason, status: m.status,
      requestedBy: m.requestedBy
    }));
    await insertRows(conn, 'movementLogs', movementLogs);

    const notifications = d.notifications.map(n => ({
      userId: null, message: n.message, time: n.time, read: n.read ? 1 : 0, type: n.type
    }));
    await insertRows(conn, 'notifications', notifications);

    const nameToId = {};
    d.users.forEach(u => { nameToId[u.name] = u.id; });
    const auditLogs = d.auditLogs.map(a => ({
      time: a.time, userId: nameToId[a.user] || null, userName: a.user,
      action: a.action, icon: a.icon, color: a.color
    }));
    await insertRows(conn, 'auditLogs', auditLogs);

    // `kpis` adalah VIEW yang dihitung otomatis — tidak perlu di-seed.

    await conn.commit();
    console.log(`[seed] berhasil: ${users.length} users, ${toolings.length} toolings, ${maintenanceLogs.length} maintenance, ${supplierTasks.length} tasks, ${shootLogs.length} shootLogs, ${deliveryLogs.length} deliveryLogs, ${movementLogs.length} movements, ${notifications.length} notif, ${auditLogs.length} auditLogs.`);
    console.log(`[seed] Semua user login dengan password default: "${DEFAULT_PASSWORD}"`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function seedIfNeeded() {
  if (process.env.AUTO_SEED === 'false') return;
  await withRetry(seed, 3, 5000);
}

if (require.main === module) {
  seedIfNeeded()
    .then(() => { console.log('Seed selesai.'); process.exit(0); })
    .catch(err => { console.error('Seed gagal:', err); process.exit(1); });
}

module.exports = { seed, seedIfNeeded };
