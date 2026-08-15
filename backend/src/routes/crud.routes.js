const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireAdmin, ADMIN_ROLES } = require('../middleware/auth');

const router = express.Router();

const TABLES = {
  users: ['id', 'username', 'email', 'passwordHash', 'role', 'name', 'company', 'supplierId'],
  toolings: [
    'id', 'name', 'type', 'partNumber', 'partName', 'model', 'supplier', 'supplierId',
    'supplierAddress', 'status', 'condition', 'owner', 'lifetime', 'maxShoot',
    'lastMaintenance', 'maker', 'weight', 'tonnage', 'dimensions', 'toolImage',
    'toolImage2', 'partImage', 'material', 'depreciationType', 'depreciationValue',
    'qtyDepreciation', 'paNumber', 'paDocumentName', 'paDocumentPath', 'drawingDiesName',
    'drawingDiesPath', 'price', 'notes', 'pic', 'picEmail', 'picPhone', 'qtyPerTooling', 'mapUrl'
  ],
  maintenanceLogs: [
    'id', 'toolId', 'toolName', 'dateStart', 'dateEnd', 'type', 'description', 'status',
    'evidence', 'evidencePath', 'requestedBy', 'cost'
  ],
  supplierTasks: [
    'id', 'toolId', 'toolName', 'supplier', 'supplierId', 'type', 'description',
    'assignedDate', 'dueDate', 'status', 'priority', 'completedDate', 'evidence', 'evidencePath'
  ],
  shootLogs: ['id', 'toolId', 'month', 'inputDate', 'shootCount'],
  productionLogs: ['id', 'toolId', 'shootLogId', 'actualPartOk'],
  deliveryLogs: ['id', 'toolId', 'month', 'inputDate', 'qtyDelivered', 'qtyOk'],
  movementLogs: [
    'id', 'toolId', 'toolName', 'fromLocation', 'toLocation', 'date', 'reason', 'status', 'requestedBy'
  ],
  notifications: ['id', 'userId', 'message', 'time', 'read', 'type'],
  auditLogs: ['id', 'time', 'userId', 'userName', 'action', 'icon', 'color'],
  kpis: ['id', 'totalActive', 'openRepairs', 'pendingApprovals', 'overdueTasks']
};

function isAdmin(user) {
  return user && ADMIN_ROLES.includes(user.role);
}

function canWrite(user, table, payload) {
  if (isAdmin(user)) return { ok: true };
  if (table === 'supplierTasks') {
    const supId = payload && payload.supplierId;
    const userSup = user.supplierId || null;
    return { ok: supId === undefined || supId === userSup, error: 'Anda hanya dapat mengubah task milik supplier Anda' };
  }
  if (table === 'notifications' || table === 'auditLogs') {
    return { ok: true };
  }
  return { ok: false, error: 'Akses ditolak: role Anda tidak dapat mengubah data ini' };
}

async function checkSupplierTaskOwnership(user, table, id) {
  if (isAdmin(user) || table !== 'supplierTasks') return { ok: true };
  const rows = await query('SELECT `supplierId` FROM `supplierTasks` WHERE `id` = ? LIMIT 1', [id]);
  if (!rows[0]) return { ok: true };
  if (rows[0].supplierId !== (user.supplierId || null)) {
    return { ok: false, error: 'Anda hanya dapat mengubah task milik supplier Anda' };
  }
  return { ok: true };
}

function filterPayload(table, obj) {
  const allowed = TABLES[table];
  const out = {};
  for (const key of Object.keys(obj || {})) {
    if (allowed.includes(key) && obj[key] !== undefined) {
      out[key] = obj[key] === null ? null : obj[key];
    }
  }
  return out;
}

// GET /api/loadAll — semua koleksi dalam satu panggilan
router.get('/loadAll', requireAuth, async (req, res) => {
  try {
    const names = [
      'users', 'toolings', 'maintenanceLogs', 'supplierTasks', 'shootLogs',
      'productionLogs', 'deliveryLogs', 'movementLogs', 'notifications', 'auditLogs'
    ];
    const result = {};
    for (const table of names) {
      const rows = await query(`SELECT * FROM \`${table}\` ORDER BY \`createdAt\` DESC`);
      result[table] = table === 'users'
        ? rows.map(r => { const { passwordHash, ...rest } = r; return rest; })
        : rows;
    }
    const kpiRows = await query('SELECT * FROM `kpis` LIMIT 1');
    result.kpis = kpiRows[0] || { totalActive: 0, openRepairs: 0, pendingApprovals: 0, overdueTasks: 0 };
    res.json(result);
  } catch (err) {
    console.error('loadAll error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kpis — baris tunggal
router.get('/kpis', requireAuth, async (req, res) => {
  const rows = await query('SELECT * FROM `kpis` LIMIT 1');
  res.json(rows[0] || null);
});

// Generic CRUD: /api/:table dan /api/:table/:id
router.use(requireAuth);

router.get('/:table', async (req, res) => {
  const table = req.params.table;
  if (!TABLES[table]) return res.status(404).json({ error: 'Tabel tidak dikenal: ' + table });
  try {
    const rows = await query(`SELECT * FROM \`${table}\` ORDER BY \`createdAt\` DESC`);
    res.json(table === 'users' ? rows.map(r => { const { passwordHash, ...rest } = r; return rest; }) : rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:table/:id', async (req, res) => {
  const table = req.params.table;
  if (!TABLES[table]) return res.status(404).json({ error: 'Tabel tidak dikenal: ' + table });
  try {
    const rows = await query(`SELECT * FROM \`${table}\` WHERE \`id\` = ? LIMIT 1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Data tidak ditemukan' });
    const row = table === 'users' ? (() => { const { passwordHash, ...rest } = rows[0]; return rest; })() : rows[0];
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:table', async (req, res) => {
  const table = req.params.table;
  if (!TABLES[table]) return res.status(404).json({ error: 'Tabel tidak dikenal: ' + table });
  const payload = filterPayload(table, req.body);
  const perm = canWrite(req.user, table, payload);
  if (!perm.ok) return res.status(403).json({ error: perm.error });
  try {
    if (table === 'users') {
      const bcrypt = require('bcryptjs');
      const rawPassword = req.body && req.body.password;
      payload.passwordHash = rawPassword
        ? bcrypt.hashSync(String(rawPassword), 10)
        : (payload.passwordHash || bcrypt.hashSync('password', 10));
      if (!payload.email) payload.email = `${payload.username}@dtms.mail`;
      payload.email = String(payload.email).toLowerCase();
    }
    if (table === 'kpis') {
      const rows = await query('SELECT * FROM `kpis` LIMIT 1');
      return res.status(201).json(rows[0] || { totalActive: 0, openRepairs: 0, pendingApprovals: 0, overdueTasks: 0 });
    }
    const cols = Object.keys(payload);
    const colSql = cols.map(c => '`' + c + '`').join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const result = await query(
      `INSERT INTO \`${table}\` (${colSql}) VALUES (${placeholders})`,
      cols.map(c => payload[c])
    );
    const id = payload.id !== undefined ? payload.id : result.insertId;
    const rows = await query(`SELECT * FROM \`${table}\` WHERE \`id\` = ? LIMIT 1`, [id]);
    const row = table === 'users' ? (() => { const { passwordHash, ...rest } = rows[0]; return rest; })() : rows[0];
    res.status(201).json(row);
  } catch (err) {
    console.error('insert error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:table/:id', async (req, res) => {
  const table = req.params.table;
  if (!TABLES[table]) return res.status(404).json({ error: 'Tabel tidak dikenal: ' + table });
  if (table === 'kpis') return res.status(400).json({ error: 'KPI dihitung otomatis — tidak dapat diubah' });
  const payload = filterPayload(table, req.body);
  const perm = canWrite(req.user, table, payload);
  if (!perm.ok) return res.status(403).json({ error: perm.error });
  const own = await checkSupplierTaskOwnership(req.user, table, req.params.id);
  if (!own.ok) return res.status(403).json({ error: own.error });
  try {
    if (table === 'users' && req.body && req.body.password) {
      payload.passwordHash = require('bcryptjs').hashSync(String(req.body.password), 10);
    }
    const cols = Object.keys(payload).filter(c => c !== 'id');
    if (cols.length) {
      const setSql = cols.map(c => '`' + c + '` = ?').join(', ');
      await query(`UPDATE \`${table}\` SET ${setSql} WHERE \`id\` = ?`, cols.map(c => payload[c]).concat(req.params.id));
    }
    const rows = await query(`SELECT * FROM \`${table}\` WHERE \`id\` = ? LIMIT 1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Data tidak ditemukan' });
    const row = table === 'users' ? (() => { const { passwordHash, ...rest } = rows[0]; return rest; })() : rows[0];
    res.json(row);
  } catch (err) {
    console.error('update error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:table/:id', async (req, res) => {
  const table = req.params.table;
  if (!TABLES[table]) return res.status(404).json({ error: 'Tabel tidak dikenal: ' + table });
  if (table === 'kpis') return res.status(400).json({ error: 'KPI dihitung otomatis — tidak dapat dihapus' });
  const perm = canWrite(req.user, table, {});
  if (!perm.ok) return res.status(403).json({ error: perm.error });
  const own = await checkSupplierTaskOwnership(req.user, table, req.params.id);
  if (!own.ok) return res.status(403).json({ error: own.error });
  try {
    await query(`DELETE FROM \`${table}\` WHERE \`id\` = ?`, [req.params.id]);
    res.json({ data: { success: true }, error: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
