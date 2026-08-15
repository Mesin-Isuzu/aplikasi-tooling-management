const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const { migrate } = require('./utils/migrate');
const { seedIfNeeded } = require('./utils/seed');
const authRoutes = require('./routes/auth.routes');
const crudRoutes = require('./routes/crud.routes');
const uploadRoutes = require('./routes/upload.routes');
const { router: uploadRouter, UPLOAD_DIR } = uploadRoutes;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length
    ? (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Origin tidak diizinkan: ' + origin));
      }
    : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.get('/', (req, res) => res.json({ name: 'DTMS API', status: 'ok' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRouter);
app.use('/api', crudRoutes);

app.use((err, req, res, next) => {
  if (err && err.message && err.message.startsWith('Origin')) {
    return res.status(403).json({ error: err.message });
  }
  console.error('server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT || 3000);

async function start() {
  await migrate();
  await seedIfNeeded();
  app.listen(PORT, () => {
    console.log(`[server] DTMS API berjalan di port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Gagal start server:', err);
  process.exit(1);
});
