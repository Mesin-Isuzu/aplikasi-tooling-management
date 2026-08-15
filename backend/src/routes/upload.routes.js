const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function sanitizeRelPath(p) {
  if (!p) return null;
  let rel = String(p).replace(/\\/g, '/');
  rel = rel.replace(/\.\./g, '').replace(/[^a-zA-Z0-9/_\-.]/g, '_');
  rel = rel.split('/').filter(s => s && s !== '.').join('/');
  return rel;
}

function publicBase(req) {
  if (process.env.PUBLIC_API_URL) return process.env.PUBLIC_API_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

// POST /api/upload — multipart: fields 'path' + 'file'
router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
    const rel = sanitizeRelPath(req.body.path);
    if (!rel) return res.status(400).json({ error: 'Path tujuan tidak valid' });
    const abs = path.join(UPLOAD_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, req.file.buffer);
    const publicUrl = `${publicBase(req)}/uploads/${rel}`;
    res.json({ path: rel, publicUrl, error: null });
  } catch (err) {
    console.error('upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/upload?path=evidence/TS-001/1_file.pdf
router.delete('/', requireAuth, async (req, res) => {
  try {
    const rel = sanitizeRelPath(req.query.path);
    if (!rel) return res.status(400).json({ error: 'Path tidak valid' });
    const abs = path.join(UPLOAD_DIR, rel);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    res.json({ error: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, UPLOAD_DIR };
