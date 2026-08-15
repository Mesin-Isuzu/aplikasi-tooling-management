const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-ganti-di-produksi';
const ADMIN_ROLES = ['Admin Sistem', 'Purchasing MII'];

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      supplierId: user.supplierId || null
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Tidak ada token — silakan login ulang' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesi tidak valid/kedaluwarsa — silakan login ulang' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Akses ditolak: hanya Admin/Purchasing yang diizinkan' });
  }
  next();
}

module.exports = { JWT_SECRET, signToken, requireAuth, requireAdmin, ADMIN_ROLES };
