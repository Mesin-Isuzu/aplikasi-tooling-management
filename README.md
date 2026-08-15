# DTMS — Tooling Management System

Aplikasi manajemen tooling (stamping die, injection mold, die casting) dengan frontend HTML/CSS/JS dan backend **Node.js + Express + MySQL**.

## Struktur

```
├── backend/                  # REST API (Express + MySQL)
│   ├── src/
│   │   ├── server.js         # entry point (migrate + seed otomatis saat start)
│   │   ├── config/db.js      # koneksi MySQL (DATABASE_URL / MYSQL_*)
│   │   ├── middleware/auth.js# JWT (bcrypt + jsonwebtoken)
│   │   ├── routes/           # auth, CRUD generik, upload
│   │   └── utils/            # migrate (schema.sql) + seed (dari js/data.js)
│   ├── db/schema.sql         # DDL MySQL (11 tabel)
│   └── uploads/              # file evidence/foto (gitignored)
├── .github/workflows/
│   ├── deploy-backend.yml    # deploy ke Railway (railway up)
│   └── deploy-frontend.yml   # deploy ke GitHub Pages + inject API URL
├── js/config.js              # window.DTMS_API_URL (ditimpa Actions)
├── js/db.js                  # layer data: fetch ke REST API
└── index.html, css, img, ... # frontend
```

## API Utama

| Endpoint | Deskripsi |
|---|---|
| `POST /api/auth/login` | Login → JWT token |
| `GET /api/auth/me` | Profil user aktif |
| `POST /api/auth/signup` | Admin membuat akun (upsert by email) |
| `PUT /api/auth/user/:email/password` | Admin reset password |
| `GET /api/loadAll` | Semua koleksi dalam satu panggilan |
| `GET/POST /api/:table` `PUT/DELETE /api/:table/:id` | CRUD generik (users, toolings, maintenanceLogs, supplierTasks, shootLogs, productionLogs, deliveryLogs, movementLogs, notifications, auditLogs, kpis) |
| `POST /api/upload` | Upload file (multipart: `path` + `file`) |
| `GET /uploads/*` | File publik |

## Jalankan Lokal

1. Siapkan MySQL (XAMPP/Laragon/MySQL server), buat database:
   ```sql
   CREATE DATABASE dtms CHARACTER SET utf8mb4;
   ```
2. Konfigurasi backend:
   ```powershell
   Copy-Item backend\.env.example backend\.env
   # edit DATABASE_URL / MYSQL_* dan JWT_SECRET
   ```
3. Jalankan backend (migrasi & seed otomatis saat start):
   ```powershell
   cd backend
   npm install
   npm run dev
   ```
   Database kosong otomatis di-seed dari `js/data.js`.
   **Login: `admin` / `password`** (semua seed user memakai password default `password`).
4. Frontend: set `js/config.js` → `window.DTMS_API_URL = 'http://localhost:3000';` lalu buka `index.html` (mis. via `python -m http.server 9999`).

## Deployment

### Backend → Railway (database MySQL cloud via plugin)
1. Buat project baru di [Railway](https://railway.app) → **New Project → Deploy from GitHub repo** (pilih repo ini) atau Empty Project.
2. **Add Plugin → MySQL** (atau pilih "Add MySQL" saat create service). Railway otomatis meng-inject kredensial ke service backend via env var `DATABASE_URL` / `MYSQLHOST` — **backend langsung terhubung tanpa konfigurasi tambahan**. Migrasi & seed database berjalan otomatis saat pertama kali server start.
3. Set environment variables tambahan di service backend:
   - `JWT_SECRET` — string acak panjang
   - `FRONTEND_URL` — URL GitHub Pages (mis. `https://username.github.io`)
   - `PUBLIC_API_URL` — URL publik backend (mis. `https://xxx.up.railway.app`)
   - `AUTO_SEED=true` (pertama kali; bisa dimatikan setelahnya)
4. Di GitHub repo → Settings → Secrets and variables → Actions:
   - `RAILWAY_TOKEN` — dari Railway (Account → Tokens)
   - `RAILWAY_PROJECT_ID` — ID project Railway (di Settings project)
5. Push ke `main` → workflow `deploy-backend.yml` menjalankan `railway up`.

> Untuk pengembangan lokal tetap bisa memakai MySQL lokal (XAMPP/Laragon) dengan mengisi `backend/.env`.

### Frontend → GitHub Pages
1. Settings → Pages → Source: **GitHub Actions**.
2. Secret `DTMS_API_URL` = URL backend (mis. `https://xxx.up.railway.app`).
3. Push ke `main` → workflow `deploy-frontend.yml` meng-inject API URL ke `js/config.js` lalu deploy.

## Keamanan
- Password di-hash bcrypt; JWT 7 hari (atur `JWT_EXPIRES`).
- Role `Pengguna Supplier` hanya dapat mengubah `supplierTasks` milik supplier-nya.
- Endpoint user management hanya untuk `Admin Sistem` / `Purchasing MII`.
- Folder `uploads/` publik (URL file di-share di frontend) — hindari menyimpan data sensitif di sana.
- Ganti password default semua seed user sebelum produksi.
