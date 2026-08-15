const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function publicUser(row) {
  if (!row) return null;
  const { passwordHash, ...rest } = row;
  return rest;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan password wajib diisi' });
    }
    const normalized = String(email).toLowerCase();
    const rows = await query(
      'SELECT * FROM `users` WHERE LOWER(`email`) = ? LIMIT 1',
      [normalized]
    );
    let user = rows[0];
    if (!user) {
      const username = normalized.split('@')[0];
      const byName = await query('SELECT * FROM `users` WHERE `username` = ? LIMIT 1', [username]);
      user = byName[0];
    }
    if (!user || !bcrypt.compareSync(String(password), user.passwordHash)) {
      return res.status(401).json({ error: 'Kredensial salah' });
    }
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Login gagal: ' + err.message });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM `users` WHERE `id` = ? LIMIT 1', [req.user.sub]);
    if (!rows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(publicUser(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/me/metadata
router.put('/me/metadata', requireAuth, async (req, res) => {
  try {
    const meta = (req.body && req.body.metadata) || {};
    const fields = ['username', 'name', 'role', 'company', 'supplierId'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (meta[f] !== undefined) {
        sets.push('`' + f + '` = ?');
        params.push(meta[f]);
      }
    }
    if (sets.length) {
      params.push(req.user.sub);
      await query(`UPDATE \`users\` SET ${sets.join(', ')} WHERE \`id\` = ?`, params);
    }
    const rows = await query('SELECT * FROM `users` WHERE `id` = ? LIMIT 1', [req.user.sub]);
    res.json(publicUser(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/signup — admin membuat akun baru (upsert by email)
router.post('/signup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, password, ...meta } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan password wajib diisi' });
    }
    const passwordHash = bcrypt.hashSync(String(password), 10);
    const username = meta.username || String(email).split('@')[0];

    const existing = await query('SELECT * FROM `users` WHERE LOWER(`email`) = ? LIMIT 1', [String(email).toLowerCase()]);
    let user;
    if (existing[0]) {
      const sets = ['`passwordHash` = ?'];
      const params = [passwordHash];
      for (const f of ['username', 'name', 'role', 'company', 'supplierId']) {
        if (meta[f] !== undefined) {
          sets.push('`' + f + '` = ?');
          params.push(meta[f]);
        }
      }
      params.push(existing[0].id);
      await query(`UPDATE \`users\` SET ${sets.join(', ')} WHERE \`id\` = ?`, params);
      user = (await query('SELECT * FROM `users` WHERE `id` = ? LIMIT 1', [existing[0].id]))[0];
    } else {
      const result = await query(
        'INSERT INTO `users` (`username`, `email`, `passwordHash`, `role`, `name`, `company`, `supplierId`) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [username, String(email).toLowerCase(), passwordHash, meta.role || null, meta.name || null, meta.company || null, meta.supplierId || null]
      );
      user = (await query('SELECT * FROM `users` WHERE `id` = ? LIMIT 1', [result.insertId]))[0];
    }
    res.json({ user: publicUser(user), error: null });
  } catch (err) {
    console.error('signup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/user/:email/password — admin reset password
router.put('/user/:email/password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password wajib diisi' });
    const passwordHash = bcrypt.hashSync(String(password), 10);
    const result = await query(
      'UPDATE `users` SET `passwordHash` = ? WHERE LOWER(`email`) = ?',
      [passwordHash, String(req.params.email).toLowerCase()]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json({ data: { success: true }, error: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auth/user/:email — penanda hapus akun (baris users dihapus via CRUD users)
router.delete('/user/:email', requireAuth, requireAdmin, async (req, res) => {
  res.json({ data: { success: true }, error: null });
});

module.exports = router;
