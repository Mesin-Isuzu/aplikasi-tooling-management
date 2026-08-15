// Safe storage: fallback to in-memory when localStorage unavailable (e.g. Chrome file://)
const safeStorage = {
    _data: {},
    getItem(k) { try { return localStorage.getItem(k); } catch(e) { return this._data[k]||null; } },
    setItem(k,v) { try { localStorage.setItem(k,v); } catch(e) { this._data[k]=v; } },
    removeItem(k) { try { localStorage.removeItem(k); } catch(e) { delete this._data[k]; } }
};

class App {
    constructor() {
        this.appEl = document.getElementById('app');
        this.currentUser = null;
        this.data = window.dtmsData;
        this.loading = true;
        this.supabaseReady = false;

        window.addEventListener('hashchange', () => this.router());
        this.loadSessionAndData();
    }

    renderLoading() {
        this.appEl.innerHTML = `
            <div class="login-container">
                <div class="login-box" style="text-align:center">
                    <img src="img/isuzu_logo.svg" alt="ISUZU" class="login-logo">
                    <h2>DTMS</h2>
                    <p>Menghubungkan ke database...</p>
                </div>
            </div>
        `;
    }

    async loadSessionAndData() {
        this.renderLoading();

        if (window.DTMS && window.DTMS.enabled()) {
            try {
                const { data: { session } } = await window.DTMS.getSession();
                if (session && session.user) {
                    const meta = session.user.user_metadata || {};
                    this.currentUser = {
                        id: session.user.id,
                        email: session.user.email,
                        username: meta.username || session.user.email,
                        role: meta.role || 'Pengguna Supplier',
                        name: meta.name || session.user.email,
                        company: meta.company || '',
                        supplierId: meta.supplierId || null
                    };
                }
                const dbData = await window.DTMS.loadAll();
                if (dbData) {
                    this.data = dbData;
                    this.supabaseReady = true;
                    if (this.currentUser && dbData.users) {
                        const exists = dbData.users.some(u => u.email === this.currentUser.email);
                        if (!exists) {
                            await window.DTMS.logout();
                            this.currentUser = null;
                        }
                    }
                }
            } catch (err) {
                console.error('Supabase load error:', err);
                alert('Gagal terhubung ke Supabase. Aplikasi berjalan dengan data lokal.');
            }
        }

        this.loading = false;
        this.init();
    }

    init() {
        if (!this.currentUser) {
            window.location.hash = '';
            this.renderLogin();
        } else {
            if (!window.location.hash) {
                window.location.hash = '#dashboard';
            }
            this.router();
        }
    }

    router() {
        if (!this.currentUser) {
            this.renderLogin();
            return;
        }

        const hash = window.location.hash || '#dashboard';
        const [route, id] = hash.split('/').map(s => s.replace('#', ''));

        this.renderLayout();
        const contentArea = document.getElementById('content-area');

        switch (route) {
            case 'dashboard':
                contentArea.innerHTML = this.getDashboardView();
                break;
            case 'tooling':
                if (id) {
                    contentArea.innerHTML = this.getToolingDetailView(id);
                } else {
                    window.location.hash = '#dashboard';
                    return;
                }
                break;
            case 'supplier-tasks':
                contentArea.innerHTML = this.getSupplierTasksView();
                break;
            case 'maintenance':
                contentArea.innerHTML = this.getMaintenanceView();
                break;
            case 'reports':
                if (this.currentUser.role === 'Pengguna Supplier') {
                    window.location.hash = '#dashboard';
                    return;
                }
                contentArea.innerHTML = this.getReportsView();
                break;
            case 'admin':
                contentArea.innerHTML = this.getAdminView();
                break;
            default:
                contentArea.innerHTML = `<h2>404 Halaman Tidak Ditemukan</h2>`;
        }

        this.updateActiveNav(route);
    }

    togglePasswordVisibility() {
        const input = document.getElementById('password');
        const icon = input.parentElement.querySelector('.password-toggle-btn i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }

    async login(username, password) {
        const user = this.data.users.find(u => u.username === username);

        if (window.DTMS && window.DTMS.enabled()) {
            const email = `${username}@dtms.mail`;
            const { user: authUser, error } = await window.DTMS.login(email, password || 'password');
            if (error || !authUser) {
                alert('Login gagal: ' + (error?.message || 'kredensial salah'));
                return;
            }
            const meta = authUser.user_metadata || {};
            this.currentUser = {
                id: authUser.id,
                email: authUser.email,
                username: meta.username || username,
                role: meta.role || 'Pengguna Supplier',
                name: meta.name || username,
                company: meta.company || '',
                supplierId: meta.supplierId || null
            };
            // Reload data because RLS may now expose different rows
            const dbData = await window.DTMS.loadAll();
            if (dbData) this.data = dbData;
            if (dbData && dbData.users) {
              const stillExists = dbData.users.some(u => u.email === authUser.email);
              if (!stillExists) {
                await window.DTMS.logout();
                this.currentUser = null;
                alert('Akun ini telah dihapus atau dinonaktifkan. Silakan hubungi administrator.');
                return;
              }
            }
            window.location.hash = '#dashboard';
            return;
        }

        // Fallback: fake login for local development without Supabase
        if (user) {
            this.currentUser = user;
            window.location.hash = '#dashboard';
        } else {
            alert('Kredensial tidak valid. Coba: admin, purchasing, atau supplier1');
        }
    }

    async logout() {
        if (window.DTMS && window.DTMS.enabled()) {
            await window.DTMS.logout();
        }
        this.currentUser = null;
        window.location.hash = '';
        this.renderLogin();
    }

    _supplierIdByName(name) {
        const map = {
            'PT Auto Parts': 'SUP001',
            'PT Plasticindo': 'SUP002',
            'PT Metalindo': 'SUP003'
        };
        if (map[name]) return map[name];
        const u = this.data.users.find(x => x.name === name || x.company === name);
        return u?.supplierId || null;
    }

    _validateMapUrl(url) {
        if (!url || url.trim() === '') return true;
        const lower = url.toLowerCase();
        if (lower.includes('maps.app.goo.gl')) {
            return { valid: false, msg: 'URL maps.app.goo.gl tidak bisa ditampilkan di peta. Gunakan URL embed dari Google Maps (Share > Embed a map).' };
        }
        if (lower.includes('goo.gl')) {
            return { valid: false, msg: 'Short URL Google tidak bisa di-embed. Gunakan URL embed dari Google Maps (Share > Embed a map).' };
        }
        if (!lower.startsWith('https://www.google.com/maps/embed?')) {
            return { valid: false, msg: 'URL peta harus dalam format embed Google Maps, contoh:\nhttps://www.google.com/maps/embed?pb=...' };
        }
        return { valid: true };
    }

    updateActiveNav(route) {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const activeLink = document.querySelector(`.nav-item[href="#${route}"]`);
        if (activeLink) activeLink.classList.add('active');
    }

    getStatusBadge(status) {
        const map = {
            'Aktif': 'badge-success',
            'Dalam Perbaikan': 'badge-warning',
            'Tidak Aktif': 'badge-secondary'
        };
        return `<span class="badge ${map[status] || 'badge-info'}">${status}</span>`;
    }

    getConditionBadge(condition) {
        const map = {
            'Baik': 'text-success',
            'Perlu Perbaikan': 'text-warning',
            'NG': 'text-danger'
        };
        return `<span class="font-semibold ${map[condition] || ''}">${condition}</span>`;
    }

    renderLogin() {
        this.appEl.innerHTML = this.getLoginView();
    }

    getLoginView() {
        return `
            <div class="login-container">
                <div class="login-box">
                    <div class="login-header">
                        <img src="img/isuzu_logo.svg" alt="ISUZU" class="login-logo">
                        <h2>MESIN ISUZU INDONESIA</h2>
                        <p>Dies & Tool Management</p>
                    </div>
                    <form class="login-form" onsubmit="event.preventDefault(); app.login(document.getElementById('username').value, document.getElementById('password').value);">
                        <div class="form-group">
                            <label class="form-label">Username</label>
                            <input type="text" id="username" class="form-control" placeholder="Masukkan username" required value="">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Kata Sandi</label>
                            <div class="password-input-wrapper">
                                <input type="password" id="password" class="form-control" placeholder="Masukkan kata sandi" required value="">
                                <button type="button" class="password-toggle-btn" onclick="app.togglePasswordVisibility()" tabindex="-1">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </div>
                        <button type="submit" class="login-btn">Masuk ke Portal</button>
                    </form>
            </div>
        `;
    }

    renderLayout() {
        if (document.getElementById('app-layout')) return;

        this.appEl.innerHTML = `
            <div class="app-container" id="app-layout">
                <aside class="sidebar">
                    <div class="sidebar-brand">
                        <img src="img/isuzu_logo.svg" alt="ISUZU" class="sidebar-logo">
                        <span class="sidebar-brand-text">MESIN ISUZU INDONESIA</span>
                    </div>
                    <nav class="sidebar-nav">
                        <a href="#dashboard" class="nav-item"><i class="fas fa-home"></i> Ringkasan Dashboard</a>
                        <a href="#supplier-tasks" class="nav-item"><i class="fas fa-tasks"></i> Tugas Supplier</a>
                        ${!this.currentUser.role.includes('Supplier') ? `<a href="#reports" class="nav-item"><i class="fas fa-chart-bar"></i> Laporan & KPI</a>` : ''}
                        ${this.currentUser.role.includes('Admin') ? `<a href="#admin" class="nav-item"><i class="fas fa-cog"></i> Pengaturan Admin</a>` : ''}
                    </nav>
                    <div class="sidebar-footer">
                        <div class="user-info">
                            <div class="user-avatar">${this.currentUser.name.charAt(0)}</div>
                            <div class="user-details">
                                <div class="user-name">${this.currentUser.name}</div>
                                <div class="user-role">${this.currentUser.role}</div>
                            </div>
                            <button class="logout-btn" onclick="app.logout()" title="Keluar">
                                <i class="fas fa-sign-out-alt"></i>
                            </button>
                        </div>
                    </div>
                </aside>
                <main class="main-content">
                    <header class="top-header">
                        <div class="page-title" id="header-title">Dashboard</div>
                        <div class="header-actions">
                            <button class="notification-btn" title="Notifikasi" onclick="app.toggleNotifications()">
                                <i class="far fa-bell"></i>
                                <span class="notification-badge">${(this.data.notifications||[]).filter(n=>!n.read).length || ''}</span>
                            </button>
                            <div id="notification-panel" class="notification-panel" style="display:none;"></div>
                        </div>
                    </header>
                    <div class="content-area" id="content-area"></div>
                </main>
            </div>
        `;
    }

    getDashboardView() {
        document.getElementById('header-title').innerText = 'Ringkasan Dashboard';
        
        let toolings = this.data.toolings;
        if (this.currentUser.role === 'Pengguna Supplier') {
            toolings = toolings.filter(t => t.supplier === this.currentUser.name);
        }

        const total = toolings.length;
        const sAktif=toolings.filter(t=>t.status==='Aktif').length;
        const sDalamPerbaikan=toolings.filter(t=>t.status==='Dalam Perbaikan').length;
        const sTidakAktif=toolings.filter(t=>t.status==='Tidak Aktif').length;
        const cBaik=toolings.filter(t=>t.condition==='Baik').length;
        const cPerluPerbaikan=toolings.filter(t=>t.condition==='Perlu Perbaikan').length;
        const cNG=toolings.filter(t=>t.condition==='NG').length;

        let tableRows = toolings.map((t, i) => `
            <tr data-status="${t.status}" data-type="${t.type}" data-condition="${t.condition}">
                <td>${i + 1}</td>
                <td><a href="#tooling/${t.id}" class="font-semibold">${t.id}</a></td>
                <td>${t.name}<br><span class="text-muted" style="font-size: 0.75rem">${t.type}</span></td>
                <td>${t.partNumber}</td>
                <td>${t.partName}</td>
                <td>${t.supplier}</td>
                <td>${this.getStatusBadge(t.status)}</td>
                <td>${this.getConditionBadge(t.condition)}</td>
            </tr>
        `).join('');

        setTimeout(() => this.initTableSearch(), 0);

        return `
            <div class="kpi-grid kpi-dashboard">
                <div class="kpi-card kpi-total">
                    <div class="kpi-icon dark"><i class="fas fa-cubes"></i></div>
                    <div class="kpi-content">
                        <span class="kpi-title">Total Tooling</span>
                        <div class="kpi-value">${total}</div>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-icon green"><i class="fas fa-check-circle"></i></div>
                    <div class="kpi-content">
                        <span class="kpi-title">Aktif</span>
                        <div class="kpi-value">${sAktif}</div>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-icon orange"><i class="fas fa-wrench"></i></div>
                    <div class="kpi-content">
                        <span class="kpi-title">Dalam Perbaikan</span>
                        <div class="kpi-value">${sDalamPerbaikan}</div>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-icon gray"><i class="fas fa-ban"></i></div>
                    <div class="kpi-content">
                        <span class="kpi-title">Tidak Aktif</span>
                        <div class="kpi-value">${sTidakAktif}</div>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-icon green"><i class="fas fa-heart"></i></div>
                    <div class="kpi-content">
                        <span class="kpi-title">Kondisi Baik</span>
                        <div class="kpi-value">${cBaik}</div>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-icon orange"><i class="fas fa-exclamation-circle"></i></div>
                    <div class="kpi-content">
                        <span class="kpi-title">Kondisi Perlu Perbaikan</span>
                        <div class="kpi-value">${cPerluPerbaikan}</div>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-icon red"><i class="fas fa-heart-broken"></i></div>
                    <div class="kpi-content">
                        <span class="kpi-title">Kondisi NG</span>
                        <div class="kpi-value">${cNG}</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                        <h3 class="card-title">Register Induk Tooling</h3>
                    <div class="header-actions">
                        <button class="btn btn-secondary" onclick="app.toggleFilter()"><i class="fas fa-filter"></i> Filter</button>
                        ${this.currentUser.role.includes('Admin') ? `<button class="btn btn-primary" onclick="app.openAddToolingModal()"><i class="fas fa-plus"></i> Daftar Tooling Baru</button>` : ''}
                    </div>
                </div>
                <div class="table-toolbar">
                    <div class="search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" class="form-control" id="toolingSearch" placeholder="Cari berdasarkan ID, Nama, Nomor Part...">
                    </div>
                    <button class="btn btn-secondary" onclick="app.exportToolingExcel()"><i class="fas fa-file-export"></i> Ekspor</button>
                    ${!this.currentUser.role.includes('Supplier') ? `<button class="btn btn-secondary" onclick="app.openImportToolingModal()"><i class="fas fa-file-import"></i> Impor</button>` : ''}
                </div>
                <div class="table-responsive">
                    <table class="table" id="toolingTable">
                        <thead>
                            <tr>
                                <th>No.</th>
                                <th>ID Tooling</th>
                                <th>Nama / Tipe</th>
                                <th>Nomor Part</th>
                                <th>Nama Part</th>
                                <th>Supplier</th>
                                <th>Status</th>
                <th>Kondisi</th>
            </tr>
        </thead>
        <tbody>
            ${tableRows}
        </tbody>
    </table>
</div>
</div>
`;
}

getToolingListView() {
        document.getElementById('header-title').innerText = 'Register Induk Tooling';
        let toolings = this.data.toolings;
        
        if (this.currentUser.role === 'Pengguna Supplier') {
            toolings = toolings.filter(t => t.supplier === this.currentUser.name);
        }

        let tableRows = toolings.map((t, i) => `
            <tr>
                <td>${i + 1}</td>
                <td><a href="#tooling/${t.id}" class="font-semibold">${t.id}</a></td>
                <td>${t.name}<br><span class="text-muted" style="font-size: 0.75rem">${t.type}</span></td>
                <td>${t.partNumber}</td>
                <td>${t.supplier}</td>
                <td>${this.getStatusBadge(t.status)}</td>
                <td>${this.getConditionBadge(t.condition)}</td>
                <td>
                    <a href="#tooling/${t.id}" class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">Lihat</a>
                </td>
            </tr>
        `).join('');

        return `
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Daftar Tooling/Dies</h3>
                    <div class="header-actions">
                        <button class="btn btn-secondary" onclick="app.toggleFilter()"><i class="fas fa-filter"></i> Saring</button>
                        ${this.currentUser.role.includes('Admin') ? `<button class="btn btn-primary" onclick="app.openAddToolingModal()"><i class="fas fa-plus"></i> Daftar Tooling Baru</button>` : ''}
                    </div>
                </div>
                <div class="table-toolbar">
                    <div class="search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" class="form-control" id="toolingSearch" placeholder="Cari berdasarkan ID, Nama, Nomor Part...">
                    </div>
                    <button class="btn btn-secondary" onclick="app.exportToolingExcel()"><i class="fas fa-file-export"></i> Ekspor</button>
                    ${!this.currentUser.role.includes('Supplier') ? `<button class="btn btn-secondary" onclick="app.openImportToolingModal()"><i class="fas fa-file-import"></i> Impor</button>` : ''}
                </div>
                <div class="table-responsive">
                    <table class="table" id="toolingTable">
                        <thead>
                            <tr>
                                <th>No.</th>
                                <th>ID Tooling</th>
                                <th>Nama / Tipe</th>
                                <th>Nomor Part</th>
                                <th>Supplier</th>
                                <th>Status</th>
                                <th>Kondisi</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    initTableSearch() {
        const searchInput = document.getElementById('toolingSearch');
        if (!searchInput) return;
        
        searchInput.addEventListener('keyup', (e) => {
            const term = e.target.value.toLowerCase();
            const rows = document.querySelectorAll('#toolingTable tbody tr');
            rows.forEach(row => {
                const text = row.innerText.toLowerCase();
                row.style.display = text.includes(term) ? '' : 'none';
            });
            this.updateRowNumbers();
        });
    }

    getToolingDetailView(id) {
        const t = this.data.toolings.find(x => x.id === id);
        if (!t) return `<h2>Tooling tidak ditemukan</h2>`;

        const isSupplier = this.currentUser.role.includes('Supplier');
        const canEditPhotos = isSupplier && !!this.currentUser.supplierId && t.supplierId === this.currentUser.supplierId;
        
        document.getElementById('header-title').innerText = `Detail Tooling: ${t.id}`;

        return `
            <div class="mb-4">
                <a href="#tooling" class="btn btn-secondary"><i class="fas fa-arrow-left"></i> Kembali ke Daftar</a>
            </div>
            
            <div class="detail-header">
                <div class="detail-info">
                    <h2>${t.name}</h2>
                    <div class="detail-meta">
                        <span><i class="fas fa-tag"></i> ${t.type}</span>
                        <span><i class="fas fa-truck"></i> Model: ${t.model}</span>
                    </div>
                </div>
                <div class="header-actions">
                    <button class="btn btn-secondary" id="btn-riwayat-perbaikan" onclick="document.getElementById('repair-history-section').scrollIntoView({behavior:'smooth'})"><i class="fas fa-history"></i> Riwayat Pemeliharaan</button>
                    ${this.currentUser.role.includes('Admin') ? `<button class="btn btn-primary" onclick="app.openEditToolingModal('${t.id}')"><i class="fas fa-edit"></i> Ubah</button>` : ''}
                </div>
            </div>

            <div class="card" style="margin-bottom: 1rem;">
                <div class="card-header"><h3 class="card-title">Foto Tooling & Part</h3></div>
                <div class="card-body">
                    <div class="tooling-photo-grid">
                        <div>
                            <span class="info-label">Foto Part</span>
                            ${t.partImage ? `<img src="${t.partImage}" alt="Part Image" style="width: 100%; height: auto; border-radius: 8px; margin-top: 0.5rem; border: 1px solid var(--border-color);">` : '<div style="background: #f1f5f9; padding: 2rem; text-align: center; border-radius: 8px; margin-top: 0.5rem; color: #64748b;">Belum ada foto</div>'}
                            ${canEditPhotos ? `<div style="display:flex;gap:0.5rem;margin-top:0.5rem">${t.partImage ? `<button class="btn btn-danger btn-sm" onclick="app.removePhoto('${t.id}','partImage')" style="font-size:0.75rem"><i class="fas fa-trash"></i></button>` : ''}<button class="btn btn-primary btn-sm" onclick="app.openPhotoUploadModal('${t.id}','partImage')" style="font-size:0.75rem"><i class="fas fa-upload"></i> ${t.partImage ? 'Ganti' : 'Upload'}</button></div>` : ''}
                        </div>
                        <div>
                            <span class="info-label">Foto Tooling/Dies 1</span>
                            ${t.toolImage ? `<img src="${t.toolImage}" alt="Tooling Image 1" style="width: 100%; height: auto; border-radius: 8px; margin-top: 0.5rem; border: 1px solid var(--border-color);">` : '<div style="background: #f1f5f9; padding: 2rem; text-align: center; border-radius: 8px; margin-top: 0.5rem; color: #64748b;">Belum ada foto</div>'}
                            ${canEditPhotos ? `<div style="display:flex;gap:0.5rem;margin-top:0.5rem">${t.toolImage ? `<button class="btn btn-danger btn-sm" onclick="app.removePhoto('${t.id}','toolImage')" style="font-size:0.75rem"><i class="fas fa-trash"></i></button>` : ''}<button class="btn btn-primary btn-sm" onclick="app.openPhotoUploadModal('${t.id}','toolImage')" style="font-size:0.75rem"><i class="fas fa-upload"></i> ${t.toolImage ? 'Ganti' : 'Upload'}</button></div>` : ''}
                        </div>
                        <div>
                            <span class="info-label">Foto Tooling/Dies 2</span>
                            ${t.toolImage2 ? `<img src="${t.toolImage2}" alt="Tooling Image 2" style="width: 100%; height: auto; border-radius: 8px; margin-top: 0.5rem; border: 1px solid var(--border-color);">` : '<div style="background: #f1f5f9; padding: 2rem; text-align: center; border-radius: 8px; margin-top: 0.5rem; color: #64748b;">Belum ada foto</div>'}
                            ${canEditPhotos ? `<div style="display:flex;gap:0.5rem;margin-top:0.5rem">${t.toolImage2 ? `<button class="btn btn-danger btn-sm" onclick="app.removePhoto('${t.id}','toolImage2')" style="font-size:0.75rem"><i class="fas fa-trash"></i></button>` : ''}<button class="btn btn-primary btn-sm" onclick="app.openPhotoUploadModal('${t.id}','toolImage2')" style="font-size:0.75rem"><i class="fas fa-upload"></i> ${t.toolImage2 ? 'Ganti' : 'Upload'}</button></div>` : ''}
                        </div>
                    </div>
                </div>
            </div>

            <div class="info-section">
                    <div class="card">
                        <div class="card-header"><h3 class="card-title">Informasi Umum</h3></div>
                        <div class="card-body">
                            <div class="info-grid">
                                <div class="info-item">
                                    <span class="info-label">Status</span>
                                    <span class="info-value mt-4">${this.getStatusBadge(t.status)}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Kondisi</span>
                                    <span class="info-value mt-4">${this.getConditionBadge(t.condition)}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Nomor Part</span>
                                    <span class="info-value mt-4">${t.partNumber}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Nama Part</span>
                                    <span class="info-value mt-4">${t.partName}</span>
                                </div>

                            </div>
                        </div>
                    </div>

                    <div class="card mt-4">
                        <div class="card-header"><h3 class="card-title">Kepemilikan</h3></div>
                        <div class="card-body">
                            <div class="info-grid">
                                <div class="info-item">
                                    <span class="info-label">Kepemilikan</span>
                                    <span class="info-value">${t.owner}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Supplier</span>
                                    <span class="info-value">${t.supplier}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Nama PIC Tooling</span>
                                    <span class="info-value">
                                        <a href="javascript:void(0)" onclick="document.getElementById('pic-contact-${t.id}').style.display = document.getElementById('pic-contact-${t.id}').style.display === 'none' ? 'block' : 'none'" style="color: var(--primary-color); text-decoration: none; border-bottom: 1px dashed var(--primary-color); font-weight: 500;"><i class="fas fa-user-circle"></i> ${t.pic || '-'}</a>
                                        <div id="pic-contact-${t.id}" style="display: none; margin-top: 0.5rem; padding: 0.75rem; background: #f8fafc; border-radius: 6px; font-size: 0.85rem; border: 1px solid var(--border-color);">
                                            <div style="color: #475569;"><i class="fas fa-envelope" style="width: 16px;"></i> ${t.picEmail || '-'}</div>
                                            <div style="margin-top: 0.35rem; color: #475569;"><i class="fas fa-phone" style="width: 16px;"></i> ${t.picPhone || '-'}</div>
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
            </div>

                    <div class="card mt-4">
                        <div class="card-header"><h3 class="card-title">Spesifikasi Tool/Dies</h3></div>
                        <div class="card-body">
                            <div class="info-grid">
                                <div class="info-item">
                                    <span class="info-label">Tool/Dies Maker</span>
                                    <span class="info-value">${t.maker || '-'}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">QTY Part per Shoot</span>
                                    <span class="info-value">${t.qtyPerTooling || '-'}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Berat Tool/Dies</span>
                                    <span class="info-value">${t.weight || '-'}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Tonase Mesin</span>
                                    <span class="info-value">${t.tonnage || '-'}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Dimensi Utama (PxLxT)</span>
                                    <span class="info-value">${t.dimensions || '-'}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Material Dies/Tooling</span>
                                    <span class="info-value">${t.material || '-'}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Maximum Shoot</span>
                                    <span class="info-value font-semibold">${t.maxShoot ? t.maxShoot.toLocaleString('id-ID') : '-'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

            <div class="grid-2">
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">Info Life Time</h3>
                            <button class="btn btn-secondary btn-sm" onclick="app.openShootLogModal('${t.id}')"><i class="fas fa-chart-line"></i> Riwayat Shoot</button>
                        </div>
                        <div class="card-body">
                            ${(() => {
                                const toolLogs = (this.data.shootLogs || []).filter(l => l.toolId === t.id).sort((a, b) => a.month.localeCompare(b.month));
                                const lastShoot = toolLogs.reduce((sum, l) => sum + l.shootCount, 0);
                                const maxLife = t.maxShoot || 1000000;
                                const lifeRatio = maxLife > 0 ? (lastShoot / maxLife * 100) : 0;
                                return `
                            <div class="info-list">
                                <div class="info-item">
                                    <span class="info-label">Life Time</span>
                                    <span class="info-value">${lastShoot.toLocaleString('id-ID')} / ${maxLife.toLocaleString('id-ID')} shot</span>
                                    <div style="width: 100%; height: 6px; background: var(--border-color); border-radius: 3px; margin-top: 0.5rem;">
                                        <div style="width: ${lifeRatio}%; height: 100%; background: var(--accent-color); border-radius: 3px;"></div>
                                    </div>
                                </div>
                                <div class="info-item mt-4">
                                    <span class="info-label">Life Tool Ratio</span>
                                    <span class="info-value font-bold" style="color: var(--accent-color)">${lifeRatio.toFixed(1)}%</span>
                                </div>
                                <hr style="border:0; border-top: 1px solid var(--border-color); margin: 0.75rem 0;">
                                <div class="info-item">
                                    <span class="info-label">Pemeliharaan Terakhir</span>
                                    <span class="info-value">${(() => {
                                        const doneLogs = (this.data.maintenanceLogs || []).filter(l => l.toolId === t.id && l.status === 'Selesai');
                                        let last = null;
                                        doneLogs.forEach(l => {
                                            const d = this.parseIndonesianDate(l.dateEnd || l.dateStart || '');
                                            if (d && (!last || d > last.iso)) last = { iso: d, label: l.dateEnd || l.dateStart };
                                        });
                                        return last ? last.label : '-';
                                    })()}</span>
                                </div>
                            </div>`;
                            })()}
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">Data Produksi & Quality</h3>
                            <button class="btn btn-secondary btn-sm" onclick="app.openDeliveryLogModal('${t.id}')"><i class="fas fa-truck"></i> Riwayat Pengiriman Part</button>
                        </div>
                        <div class="card-body">
                            ${(() => {
                                const isEd = !this.currentUser.role.includes('Supplier');
                                const logs = (this.data.shootLogs || []).filter(l => l.toolId === t.id).sort((a,b) => a.month.localeCompare(b.month));
                                const pLogs = (this.data.productionLogs || []).filter(p => p.toolId === t.id);
                                const qty = parseInt(t.qtyPerTooling) || 1;
                                const merged = logs.map((sl, idx) => {
                                    const pl = pLogs.find(p => p.shootLogId === sl.id);
                                    const ok = pl ? pl.actualPartOk : 0;
                                    const totalExp = sl.shootCount * qty;
                                    const rejectQ = totalExp - ok;
                                    const ratio = totalExp > 0 ? ((rejectQ / totalExp) * 100) : 0;
                                    return { sl, pl, ok, totalExp, rejectQ, ratio, idx };
                                });
                                const dLogs = (this.data.deliveryLogs || []).filter(l => l.toolId === t.id);
                                const totalKirim = dLogs.reduce((s, l) => s + (typeof l.qtyDelivered === 'number' ? l.qtyDelivered : 0), 0);
                                const totalQtyOk = dLogs.reduce((s, l) => s + (l.qtyOk || 0), 0);
                                const cumShoot = logs.reduce((s, l) => s + l.shootCount, 0);
                                const matchedDLogs = dLogs.filter(dl => logs.some(sl => sl.month === dl.month));
                                const matchedOk = matchedDLogs.reduce((s, l) => s + (l.qtyOk || 0), 0);
                                const rejRatio = cumShoot > 0 ? ((1 - matchedOk / (cumShoot * qty)) * 100) : 0;
                                const ratioColor = rejRatio < 5 ? 'var(--success-color)' : rejRatio < 10 ? 'var(--warning-color)' : 'var(--danger-color)';
                                return `
                                    <div class="info-list">
                                        <div class="info-item">
                                            <span class="info-label">Data Produksi</span>
                                            <span class="info-value">Periode pengisian ${dLogs.length} bulan</span>
                                        </div>
                                        <div class="mt-4" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;">
                                            <div class="info-item">
                                                <span class="info-label">Total Kirim</span>
                                                <span class="info-value font-semibold">${totalKirim.toLocaleString('id-ID')} pcs</span>
                                            </div>
                                            <div class="info-item">
                                                <span class="info-label">QTY OK</span>
                                                <span class="info-value font-semibold">${totalQtyOk.toLocaleString('id-ID')} pcs</span>
                                            </div>
                                            <div class="info-item">
                                                <span class="info-label">Reject Ratio</span>
                                                <span class="info-value font-bold" style="color:${ratioColor}">${rejRatio.toFixed(1)}%</span>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            })()}
                        </div>
                    </div>
                    </div>

                    <div class="grid-6-4">
                    <div class="card">
                        <div class="card-header"><h3 class="card-title">Data Finansial & Administrasi</h3></div>
                        <div class="card-body">
                            <div class="info-grid">
                                <div class="info-item" style="position:relative">
                                    <span class="info-label">No. PO/Tooling Purchase Aggreement</span>
                                    <span class="info-value" style="cursor:pointer;color:var(--accent-color)" oncontextmenu="event.preventDefault();app.showPaContextMenu(event,'${t.id}')" onclick="app.showPaContextMenu(event,'${t.id}')">${t.paNumber || '-'}${t.paDocumentName ? ` <span style="color:var(--danger-color);font-size:0.8rem;margin-left:0.5rem"><i class="fas fa-file-pdf"></i> ${Array.isArray(t.paDocumentName)?t.paDocumentName.length+' file':t.paDocumentName}</span>` : ''}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Periode Depresiasi (${t.depreciationType || 'Tahun'})</span>
                                    <span class="info-value">${t.depreciationValue || '-'} ${t.depreciationType === 'QTY Part' ? 'Pcs' : 'Tahun'}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">QTY Depresiasi (pcs)</span>
                                    <span class="info-value">${t.qtyDepreciation || '-'} pcs</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Sisa QTY Depresiasi</span>
                                    <span class="info-value">${(() => { const dLogs = (this.data.deliveryLogs || []).filter(l => l.toolId === t.id); const totalOk = dLogs.reduce((s, l) => s + (l.qtyOk || 0), 0); const qtyDep = parseInt((t.qtyDepreciation || '').replace(/,/g, '')) || 0; const sisa = qtyDep - totalOk; return sisa > 0 ? `<span class="font-semibold">${sisa.toLocaleString('id-ID')} pcs</span>` : `<span class="badge badge-success">Depresiasi sudah selesai</span>`; })()}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Tool Price</span>
                                    <span class="info-value">${t.price || '-'}</span>
                                </div>
                                ${this.currentUser.role.includes('Admin') ? `
                                <div class="info-item" style="grid-column: 1 / -1;">
                                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
                                        <span class="info-label" style="font-size:0.875rem;font-weight:600;color:var(--text-primary)"><i class="fas fa-drafting-compass" style="color:var(--accent-color);margin-right:0.35rem"></i> Drawing Dies</span>
                                        <div style="display:flex;gap:0.5rem">
                                            ${t.drawingDiesName ? `<button class="btn btn-secondary btn-sm" onclick="app.viewDrawingDies('${t.id}')" style="font-size:0.75rem"><i class="fas fa-eye"></i> Lihat</button>` : ''}
                                            ${t.drawingDiesName ? `<button class="btn btn-danger btn-sm" onclick="app.removeDrawingDies('${t.id}')" style="font-size:0.75rem"><i class="fas fa-trash"></i></button>` : ''}
                                            <button class="btn btn-primary btn-sm" onclick="app.openDrawingDiesModal('${t.id}')" style="font-size:0.75rem"><i class="fas fa-upload"></i> ${t.drawingDiesName ? 'Ganti' : 'Upload'}</button>
                                        </div>
                                    </div>
                                    ${t.drawingDiesName ? `
                                        <div style="padding:0.6rem 0.75rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--border-radius);font-size:0.85rem">
                                            <i class="fas fa-file-pdf" style="color:#16a34a;margin-right:0.5rem"></i>
                                            ${Array.isArray(t.drawingDiesName) ? t.drawingDiesName.length + ' file: ' + t.drawingDiesName.join(', ') : t.drawingDiesName}
                                        </div>
                                    ` : `
                                        <div style="padding:1rem;text-align:center;color:var(--text-secondary);background:var(--bg-color);border-radius:var(--border-radius);font-size:0.85rem">
                                            <i class="fas fa-drafting-compass" style="opacity:0.3;margin-right:0.25rem"></i> Belum ada Drawing Dies
                                        </div>
                                    `}
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header"><h3 class="card-title">Peta Lokasi Supplier</h3></div>
                        <div class="card-body">
                            <div>
                                <span class="info-label">Alamat Supplier</span>
                                <p style="margin:0.25rem 0 0.75rem;color:var(--text-secondary)">${t.supplierAddress || '-'}</p>
                                <span class="info-label">Lokasi pada Google Map</span>
                                ${t.mapUrl ? `<iframe src="${t.mapUrl}" width="100%" height="120" style="border:0; border-radius: 8px; margin-top: 0.5rem;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>` : '<div style="background: #f1f5f9; padding: 2rem; text-align: center; border-radius: 8px; margin-top: 0.5rem; color: #64748b;">Belum ada titik lokasi</div>'}
                            </div>
                        </div>
                    </div>
                    </div>

            <!-- Riwayat Pemeliharaan Section -->
            <div id="repair-history-section" class="card mt-4" style="scroll-margin-top: 1rem;">
                <div class="card-header">
                    <h3 class="card-title"><i class="fas fa-history" style="color: var(--accent-color); margin-right: 0.5rem;"></i> Riwayat Pemeliharaan</h3>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        ${this.currentUser.role === 'Pengguna Supplier' && t.supplier === this.currentUser.name ? `<button class="btn btn-primary btn-sm" onclick="app.openAddRepairModal('${t.id}', '${t.name}')"><i class="fas fa-plus"></i> Tambah Perbaikan</button>` : ''}
                        <span class="badge badge-info" style="font-size: 0.8rem; padding: 0.35rem 0.75rem;">${this.data.maintenanceLogs.filter(l => l.toolId === t.id).length} record</span>
                    </div>
                </div>
                <div class="card-body" style="padding: 0;">
                    ${(() => {
                        const logs = this.data.maintenanceLogs.filter(l => l.toolId === t.id);
                        const isSupplierOwner = this.currentUser.role === 'Pengguna Supplier' && t.supplier === this.currentUser.name;
                        if (logs.length === 0) {
                            return `
                                <div style="text-align: center; padding: 3rem 2rem; color: var(--text-secondary);">
                                    <i class="fas fa-tools" style="font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.3; display: block;"></i>
                                    <p style="font-size: 1rem; font-weight: 500; margin-bottom: 0.25rem;">Belum Ada Riwayat Pemeliharaan</p>
                                    <p style="font-size: 0.85rem;">Tool/Dies ini belum pernah menjalani perbaikan atau perawatan.</p>
                                </div>
                            `;
                        }
                        
                        const totalRepairs = logs.filter(l => l.type === 'Corrective Repair').length;
                        const totalPreventive = logs.filter(l => l.type === 'Preventive').length;
                        const completed = logs.filter(l => l.status === 'Selesai').length;
                        const ongoing = logs.length - completed;

                        return `
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; padding: 1.25rem 1.5rem; background: linear-gradient(135deg, #f8fafc 0%, #f0f4ff 100%); border-bottom: 1px solid var(--border-color);">
                                <div style="text-align: center;">
                                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary-color);">${logs.length}</div>
                                    <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Total</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="font-size: 1.5rem; font-weight: 700; color: #f59e0b;">${totalRepairs}</div>
                                    <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Corrective</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="font-size: 1.5rem; font-weight: 700; color: #10b981;">${totalPreventive}</div>
                                    <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">Preventive</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="font-size: 1.5rem; font-weight: 700; color: ${ongoing > 0 ? '#ef4444' : '#10b981'};">${ongoing > 0 ? ongoing + ' aktif' : '<i class="fas fa-check-circle"></i>'}</div>
                                    <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">${ongoing > 0 ? 'Berlangsung' : 'Semua Selesai'}</div>
                                </div>
                            </div>
                            <div class="table-responsive">
                                <table class="table" style="margin-bottom: 0;">
                                    <thead>
                                        <tr>
                                             <th>No.</th>
                                            <th>ID Ticket</th>
                                            <th>Tgl Mulai</th>
                                            <th>Tgl Selesai</th>
                                            <th>Tipe</th>
                                            <th>Deskripsi</th>
                                            <th>Status</th>
                                            <th>Evidence</th>
                                            ${isSupplierOwner ? '<th>Aksi</th>' : ''}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${logs.map((l, i) => `
                                            <tr>
                                                <td>${i + 1}</td>
                                                <td class="font-semibold">${l.id}</td>
                                                <td style="white-space: nowrap;">${l.dateStart}</td>
                                                <td style="white-space: nowrap;">${l.dateEnd || '-'}</td>
                                                <td>
                                                    <span class="badge ${l.type === 'Corrective Repair' ? 'badge-warning' : 'badge-success'}" style="font-size: 0.7rem;">
                                                        <i class="fas ${l.type === 'Corrective Repair' ? 'fa-wrench' : 'fa-shield-alt'}" style="margin-right: 0.25rem;"></i>${l.type}
                                                    </span>
                                                </td>
                                                <td style="max-width: 250px; white-space: normal;">${l.description}</td>
                                                <td>
                                                    <span class="badge ${l.status === 'Selesai' ? 'badge-success' : 'badge-warning'}">
                                                        <i class="fas ${l.status === 'Selesai' ? 'fa-check-circle' : 'fa-spinner fa-spin'}" style="margin-right: 0.25rem;"></i>${l.status}
                                                    </span>
                                                </td>
                                                <td>
                                                    <a href="javascript:void(0)" onclick="app.openEvidence('${l.id}')" style="color: var(--primary-color); font-size: 0.85rem; cursor: pointer;" title="${Array.isArray(l.evidence)?l.evidence.join(', '):l.evidence}">
                                                        <i class="fas fa-file-pdf" style="color: #ef4444; margin-right: 0.25rem;"></i>${Array.isArray(l.evidence)?l.evidence.length+' file':l.evidence}
                                                    </a>
                                                </td>
                                                ${isSupplierOwner ? `
                                                <td style="white-space: nowrap;">
                                                    <button class="btn btn-sm btn-secondary" onclick="app.openEditRepairModal('${l.id}')" title="Edit" style="padding: 0.25rem 0.5rem; margin-right: 0.25rem;"><i class="fas fa-edit"></i></button>
                                                    <button class="btn btn-sm btn-danger" onclick="app.submitDeleteRepair('${l.id}', '${t.id}')" title="Hapus" style="padding: 0.25rem 0.5rem;"><i class="fas fa-trash"></i></button>
                                                </td>
                                                ` : ''}
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        `;
                    })()}
                </div>
            </div>

            ${this.currentUser.role.includes('Admin') ? `
            <div class="card mt-4" style="border-color: var(--danger-color);">
                <div class="card-header" style="background: #fef2f2;">
                    <h3 class="card-title" style="color: var(--danger-color);"><i class="fas fa-exclamation-triangle"></i> Zona Berbahaya</h3>
                </div>
                <div class="card-body" style="text-align: center; padding: 1.5rem;">
                    <p style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 1rem;">Menghapus tooling akan menghapus seluruh data terkait secara permanen dan tidak dapat dibatalkan.</p>
                    <button class="btn btn-danger" onclick="app.confirmDeleteTooling('${t.id}', '${t.name.replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i> Hapus Tooling Ini</button>
                </div>
            </div>
            ` : ''}

        `;
    }

    confirmDeleteTooling(id, name) {
        const shootCount = (this.data.shootLogs || []).filter(l => l.toolId === id).length;
        const delivCount = (this.data.deliveryLogs || []).filter(l => l.toolId === id).length;
        const maintCount = (this.data.maintenanceLogs || []).filter(l => l.toolId === id).length;
        const taskCount = (this.data.supplierTasks || []).filter(l => l.toolId === id).length;
        const moveCount = (this.data.movementLogs || []).filter(l => l.toolId === id).length;
        const prodCount = (this.data.productionLogs || []).filter(l => l.toolId === id).length;

        const modal = document.createElement('div');
        modal.id = 'confirm-delete-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header" style="border-bottom-color: var(--danger-color);">
                    <h3 class="modal-title" style="color: var(--danger-color);"><i class="fas fa-exclamation-triangle"></i> Konfirmasi Penghapusan</h3>
                    <button class="modal-close" onclick="app.closeOverlay('confirm-delete-modal')">&times;</button>
                </div>
                <div class="modal-body" style="text-align:center;">
                    <div style="font-size: 3rem; color: var(--danger-color); margin-bottom: 0.75rem;">&#9888;&#65039;</div>
                    <p style="font-weight: 600; font-size: 1rem; margin-bottom: 0.5rem;">Anda akan menghapus:</p>
                    <p style="font-size: 1.25rem; font-weight: 700; color: var(--danger-color); margin-bottom: 1rem;">${id} - ${name}</p>
                    <div style="background: #f8fafc; border-radius: 8px; padding: 0.75rem 1rem; text-align: left; font-size: 0.85rem; margin-bottom: 1rem;">
                        <p style="margin-bottom: 0.35rem; color: var(--text-secondary);"><strong>Data yang akan ikut terhapus:</strong></p>
                        ${shootCount > 0 ? `<div style="display:flex;justify-content:space-between;padding:0.2rem 0;"><span>Riwayat Shoot</span><span style="color:var(--danger-color);font-weight:600;">${shootCount} entri</span></div>` : ''}
                        ${delivCount > 0 ? `<div style="display:flex;justify-content:space-between;padding:0.2rem 0;"><span>Riwayat Pengiriman</span><span style="color:var(--danger-color);font-weight:600;">${delivCount} entri</span></div>` : ''}
                        ${maintCount > 0 ? `<div style="display:flex;justify-content:space-between;padding:0.2rem 0;"><span>Riwayat Pemeliharaan</span><span style="color:var(--danger-color);font-weight:600;">${maintCount} entri</span></div>` : ''}
                        ${taskCount > 0 ? `<div style="display:flex;justify-content:space-between;padding:0.2rem 0;"><span>Tugas Supplier</span><span style="color:var(--danger-color);font-weight:600;">${taskCount} entri</span></div>` : ''}
                        ${moveCount > 0 ? `<div style="display:flex;justify-content:space-between;padding:0.2rem 0;"><span>Riwayat Pergerakan</span><span style="color:var(--danger-color);font-weight:600;">${moveCount} entri</span></div>` : ''}
                        ${prodCount > 0 ? `<div style="display:flex;justify-content:space-between;padding:0.2rem 0;"><span>Data Produksi</span><span style="color:var(--danger-color);font-weight:600;">${prodCount} entri</span></div>` : ''}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="app.closeOverlay('confirm-delete-modal')">Batal</button>
                    <button class="btn btn-danger" onclick="app.closeOverlay('confirm-delete-modal');app.confirmDeleteToolingStep2('${id}', '${name}')">Lanjutkan</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
    }

    confirmDeleteToolingStep2(id, name) {
        const modal = document.createElement('div');
        modal.id = 'confirm-delete-step2-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:480px;">
                <div class="modal-header" style="border-bottom-color: var(--danger-color);">
                    <h3 class="modal-title" style="color: var(--danger-color);"><i class="fas fa-keyboard"></i> Verifikasi ID Tooling</h3>
                    <button class="modal-close" onclick="app.closeOverlay('confirm-delete-step2-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1rem;">Untuk melanjutkan, ketik ID tooling <strong>${id}</strong> pada kolom di bawah ini:</p>
                    <input type="text" id="delete-confirm-input" class="form-control" placeholder="Ketik ${id} di sini..." style="text-align:center; font-size:1.1rem; font-weight:600;" oninput="app._onDeleteConfirmInput('${id}')">
                    <p id="delete-confirm-error" style="color: var(--danger-color); font-size: 0.8rem; margin-top: 0.5rem; display: none;">ID tidak cocok. Pastikan penulisan sesuai.</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="app.closeOverlay('confirm-delete-step2-modal')">Batal</button>
                    <button id="btn-confirm-delete" class="btn btn-danger" onclick="app.closeOverlay('confirm-delete-step2-modal');app.confirmDeleteToolingStep3('${id}', '${name}')" disabled>Hapus</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
    }

    _onDeleteConfirmInput(expectedId) {
        const input = document.getElementById('delete-confirm-input');
        const btn = document.getElementById('btn-confirm-delete');
        const err = document.getElementById('delete-confirm-error');
        if (!input || !btn) return;
        const match = input.value.trim() === expectedId;
        btn.disabled = !match;
        if (err) err.style.display = input.value.trim() && !match ? 'block' : 'none';
    }

    confirmDeleteToolingStep3(id, name) {
        if (!confirm('PERINGATAN TERAKHIR!\\n\\nSemua data tooling "' + id + ' - ' + name + '" dan seluruh data terkait akan dihapus secara permanen.\\n\\nTindakan ini TIDAK DAPAT dibatalkan.\\n\\nApakah Anda yakin ingin melanjutkan?')) return;
        this.executeDeleteTooling(id);
    }

    async executeDeleteTooling(id) {
        const t = this.data.toolings.find(x => x.id === id);
        if (!t) return;

        this.data.toolings = this.data.toolings.filter(x => x.id !== id);
        this.data.shootLogs = (this.data.shootLogs || []).filter(l => l.toolId !== id);
        this.data.deliveryLogs = (this.data.deliveryLogs || []).filter(l => l.toolId !== id);
        this.data.maintenanceLogs = (this.data.maintenanceLogs || []).filter(l => l.toolId !== id);
        this.data.supplierTasks = (this.data.supplierTasks || []).filter(l => l.toolId !== id);
        this.data.movementLogs = (this.data.movementLogs || []).filter(l => l.toolId !== id);
        this.data.productionLogs = (this.data.productionLogs || []).filter(l => l.toolId !== id);

        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.deleteTooling(id);}catch(e){console.error(e);alert('Gagal menghapus tooling di database.');}
        }

        alert('Tooling "' + id + ' - ' + t.name + '" dan seluruh data terkait telah dihapus.');
        document.getElementById('app-layout')?.remove();
        this.router();
    }

    closeOverlay(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
        if (!document.querySelector('.modal-overlay')) document.body.style.overflow = '';
    }


    getMaintenanceView() {
        let logs = window.dtmsData.maintenanceLogs;
        let toolings = window.dtmsData.toolings;

        if (this.currentUser.role === 'Pengguna Supplier') {
            const supplierToolingIds = toolings
                .filter(t => t.supplier === this.currentUser.name)
                .map(t => t.id);
            logs = logs.filter(l => supplierToolingIds.includes(l.toolId));
            toolings = toolings.filter(t => t.supplier === this.currentUser.name);
        }

        let rows = logs.map(l => `
            <tr>
                <td>${l.id}</td>
                <td><span class="font-semibold">${l.toolId}</span><br><span style="font-size: 0.75rem; color: var(--text-secondary);">${l.toolName}</span></td>
                <td>${l.dateStart}</td>
                <td>${l.dateEnd || '-'}</td>
                <td>${l.type}</td>
                <td>${l.description}</td>
                <td><span class="badge badge-${l.status === 'Selesai' ? 'active' : 'repair'}">${l.status}</span></td>
                <td><a href="#" style="color: var(--primary-color);"><i class="fas fa-paperclip"></i> ${Array.isArray(l.evidence)?l.evidence.length+' file':l.evidence}</a></td>
            </tr>
        `).join('');

        if (rows.length === 0) {
            rows = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 2rem;">Tidak ada riwayat maintenance.</td></tr>`;
        }

        return `
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Riwayat Perawatan & Repair</h3>
                </div>
                <div class="card-body">
                    <table class="data-table table">
                        <thead>
                            <tr>
                                <th>ID Ticket</th>
                                <th>Tooling</th>
                                <th>Tgl Mulai</th>
                                <th>Tgl Selesai</th>
                                <th>Tipe</th>
                                <th>Deskripsi</th>
                                <th>Status</th>
                                <th>Evidence</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ===== SUPPLIER TASKS MODULE =====
    getSupplierTasksView() {
        document.getElementById('header-title').innerText = 'Daftar Tugas Supplier';
        let tasks = this.data.supplierTasks || [];
        const today = new Date().toLocaleDateString('sv-SE');
        tasks.forEach(t => {
            if (t.status !== 'Selesai' && t.status !== 'Overdue' && t.dueDate && t.dueDate < today) {
                t.status = 'Overdue';
                if (window.DTMS && window.DTMS.enabled()) {
                    window.DTMS.updateSupplierTask(t.id, { status: 'Overdue' }).catch(e => console.error('Auto-overdue save error:', e));
                }
            }
        });
        if (this.currentUser.role === 'Pengguna Supplier') tasks = tasks.filter(t => t.supplier === this.currentUser.name);
        let toolings = this.data.toolings;
        if (this.currentUser.role === 'Pengguna Supplier') toolings = toolings.filter(t => t.supplier === this.currentUser.name);
        const total = toolings.length;
        const sDikerjakan = tasks.filter(t=>t.status==='Sedang Dikerjakan').length;
        const sMenunggu = tasks.filter(t=>t.status==='Menunggu Konfirmasi').length;
        const sSelesai = tasks.filter(t=>t.status==='Selesai').length;
        const sOverdue = tasks.filter(t=>t.status==='Overdue').length;
        const sBadge = (st) => ({'Sedang Dikerjakan':'badge-warning','Menunggu Konfirmasi':'badge-info','Selesai':'badge-success','Overdue':'badge-danger'}[st]||'badge-secondary');
        const fmt = (ds) => { if (!ds) return ds; const d = new Date(ds + 'T00:00:00'); return isNaN(d.getTime()) ? ds : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); };
        const isAdmin = this.currentUser.role.includes('Admin');
        const isSupplier = this.currentUser.role === 'Pengguna Supplier';
        const hasEvidence = (t) => { const e = t.evidence; return e && (Array.isArray(e) ? e.length > 0 : !!e); };
        const evidenceCell = (t) => {
            if (!hasEvidence(t)) return '-';
            const names = Array.isArray(t.evidence) ? t.evidence : [t.evidence];
            return `<a href="javascript:void(0)" onclick="app.openTaskEvidence('${t.id}')" style="color:var(--accent-color);font-size:0.85rem;cursor:pointer" title="${names.join(', ')}"><i class="fas fa-paperclip" style="margin-right:0.25rem"></i>${names.length > 1 ? names.length + ' file' : names[0]}</a>`;
        };
        const actionCell = (t) => {
            if (isAdmin) {
                return `<td><button class="btn btn-sm btn-secondary" onclick="app.openEditSupplierTaskModal('${t.id}')" title="Edit" style="padding:0.25rem 0.5rem;margin-right:0.25rem"><i class="fas fa-edit"></i></button><button class="btn btn-sm btn-danger" onclick="app.deleteSupplierTask('${t.id}')" title="Hapus" style="padding:0.25rem 0.5rem"><i class="fas fa-trash"></i></button></td>`;
            } else if (isSupplier) {
                return `<td><button class="btn btn-sm btn-info" onclick="app.openTaskEvidenceModal('${t.id}')" title="Evidence" style="padding:0.25rem 0.5rem"><i class="fas fa-upload"></i> Evidence</button></td>`;
            }
            return '';
        };
        let rows = tasks.map((t,i)=>`<tr data-status="${t.status}" data-priority="${t.priority}"><td>${i+1}</td><td class="font-semibold">${t.id}</td><td><a href="#tooling/${t.toolId}">${t.toolId}</a><br><span class="text-muted" style="font-size:0.75rem">${t.toolName}</span></td><td>${t.supplier}</td><td>${t.type}</td><td style="max-width:200px;white-space:normal">${t.description}</td><td>${fmt(t.assignedDate)}</td><td>${fmt(t.dueDate)}</td><td><span class="badge ${t.priority==='Tinggi'?'badge-danger':'badge-info'}">${t.priority}</span></td><td><span class="badge ${sBadge(t.status)}">${t.status}</span></td><td>${t.status==='Selesai'&&t.completedDate?fmt(t.completedDate):'-'}</td><td>${evidenceCell(t)}</td>${actionCell(t)}</tr>`).join('');
        if(!rows) rows=`<tr><td colspan="${isAdmin||isSupplier?13:12}" style="text-align:center;padding:2rem;color:var(--text-secondary)">Tidak ada tugas.</td></tr>`;
        const filterBtn = `<button class="btn btn-secondary" onclick="app.toggleSupplierTaskFilter()"><i class="fas fa-filter"></i> Filter</button>`;
        const toolbar = `<div class="table-toolbar">${filterBtn}</div>`;
        return `<div class="kpi-grid supplier-tasks-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:1.5rem"><div class="kpi-card" style="grid-row:span 2"><div class="kpi-icon dark"><i class="fas fa-cubes"></i></div><div class="kpi-content"><span class="kpi-title">Total Tooling</span><div class="kpi-value">${total}</div></div></div><div class="kpi-card"><div class="kpi-icon orange"><i class="fas fa-spinner"></i></div><div class="kpi-content"><span class="kpi-title">Sedang Dikerjakan</span><div class="kpi-value">${sDikerjakan}</div></div></div><div class="kpi-card"><div class="kpi-icon blue"><i class="fas fa-hourglass-half"></i></div><div class="kpi-content"><span class="kpi-title">Menunggu Konfirmasi</span><div class="kpi-value">${sMenunggu}</div></div></div><div class="kpi-card"><div class="kpi-icon green"><i class="fas fa-check-circle"></i></div><div class="kpi-content"><span class="kpi-title">Selesai</span><div class="kpi-value">${sSelesai}</div></div></div><div class="kpi-card"><div class="kpi-icon red"><i class="fas fa-exclamation-circle"></i></div><div class="kpi-content"><span class="kpi-title">Overdue</span><div class="kpi-value">${sOverdue}</div></div></div></div><div class="card"><div class="card-header"><h3 class="card-title">Daftar Tugas Supplier</h3><div class="header-actions">${isAdmin?`<button class="btn btn-primary" onclick="app.openAddSupplierTaskModal()"><i class="fas fa-plus"></i> Tugas Baru</button>`:''}</div></div>${toolbar}<div class="table-responsive"><table class="table" id="supplierTasksTable"><thead><tr><th>No.</th><th>ID</th><th>Tooling</th><th>Supplier</th><th>Tipe</th><th>Deskripsi</th><th>Ditugaskan</th><th>Deadline</th><th>Prioritas</th><th>Status</th><th>Tanggal Selesai</th><th>Evidence Selesai</th>${isAdmin||isSupplier?'<th>Aksi</th>':''}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }

    // ===== SUPPLIER TASK CRUD =====
    openAddSupplierTaskModal() {
        const modal = document.createElement('div');
        modal.id='add-task-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        const today = new Date().toLocaleDateString('sv-SE');
        const toolOpts = this.data.toolings.map(t => `<option value="${t.id}" data-supplier="${t.supplier}" data-name="${t.name}">${t.id} – ${t.name}</option>`).join('');
        const typeOpts = ['Corrective Repair','Preventive','Movement','Disposal Review'].map(t => `<option>${t}</option>`).join('');
        const prioOpts = ['Normal','Tinggi'].map(p => `<option>${p}</option>`).join('');
        const statOpts = ['Menunggu Konfirmasi','Sedang Dikerjakan','Selesai','Overdue'].map(s => `<option>${s}</option>`).join('');
        modal.innerHTML = `<div class="modal-content" style="max-width:540px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-plus-circle" style="color:var(--accent-color);margin-right:0.5rem"></i>Tugas Baru</h3><button class="modal-close" onclick="app.closeModal('add-task-modal')">&times;</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Tooling <span style="color:var(--danger-color)">*</span></label><select id="st-tool" class="form-control" onchange="app._onTaskToolChange()">${toolOpts}</select></div><div class="form-group"><label class="form-label">Supplier</label><input type="text" id="st-supplier" class="form-control" readonly style="background:#f1f5f9"></div><div class="form-group"><label class="form-label">Tipe <span style="color:var(--danger-color)">*</span></label><select id="st-type" class="form-control">${typeOpts}</select></div><div class="form-group"><label class="form-label">Deskripsi <span style="color:var(--danger-color)">*</span></label><textarea id="st-desc" class="form-control" rows="3" placeholder="Jelaskan tugas yang harus dikerjakan..."></textarea></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1rem"><div class="form-group"><label class="form-label">Deadline <span style="color:var(--danger-color)">*</span></label><input type="date" id="st-due" class="form-control" value="${today}"></div><div class="form-group"><label class="form-label">Prioritas</label><select id="st-priority" class="form-control">${prioOpts}</select></div></div><div class="form-group"><label class="form-label">Status</label><select id="st-status" class="form-control" onchange="app._toggleCompletedDate('st')">${statOpts}</select></div><div class="form-group" id="st-completedDate-group" style="display:none"><label class="form-label">Tanggal Selesai</label><input type="date" id="st-completedDate" class="form-control"></div><div class="form-group"><label class="form-label">Evidence Selesai</label><input type="file" id="st-evidence" class="form-control" accept=".pdf,.jpg,.jpeg,.png" multiple style="padding:0.375rem"><div id="st-evidence-name" style="margin-top:0.35rem;font-size:0.85rem;color:var(--text-secondary);display:none"><i class="fas fa-paperclip"></i> <span></span></div><div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-secondary)">Format: PDF, JPG, PNG. Maksimal 5MB per file.</div></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('add-task-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitAddSupplierTask()"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
        this._onTaskToolChange();
        document.getElementById('st-evidence')?.addEventListener('change', function(){
            const fs=this.files;
            const el=document.getElementById('st-evidence-name');
            if(fs&&fs.length>0){
                const names=Array.from(fs).map(f=>f.name).join(', ');
                el.querySelector('span').textContent=fs.length>1?`${fs.length} file: ${names}`:names;
                el.style.display='block';
            }
            else el.style.display='none';
        });
    }
    _onTaskToolChange() {
        const sel = document.getElementById('st-tool');
        const sup = document.getElementById('st-supplier');
        if (sel && sup) {
            const opt = sel.options[sel.selectedIndex];
            sup.value = opt?.getAttribute('data-supplier') || '';
        }
    }
    submitAddSupplierTask() {
        const v = id => document.getElementById(id)?.value?.trim() || '';
        const toolSel = document.getElementById('st-tool');
        if (!toolSel?.value) { alert('Harap pilih tooling.'); return; }
        if (!v('st-desc')) { alert('Harap isi deskripsi.'); return; }
        if (!v('st-due')) { alert('Harap isi deadline.'); return; }
        const toolOpt = toolSel.options[toolSel.selectedIndex];
        const newId = 'TS-' + String((this.data.supplierTasks.length + 1)).padStart(3, '0');
        const today = new Date().toISOString().split('T')[0];
        const fileInput = document.getElementById('st-evidence');
        const files = fileInput?.files;
        const afterRead = async (evidenceArr, nameArr, pathArr) => {
            const supplierId = this._supplierIdByName(v('st-supplier'));
            const newTask = {
                id: newId,
                toolId: toolSel.value,
                toolName: toolOpt?.getAttribute('data-name') || '',
                supplier: v('st-supplier'),
                supplierId: supplierId,
                type: v('st-type'),
                description: v('st-desc'),
                assignedDate: today,
                dueDate: v('st-due'),
                status: v('st-status') || 'Menunggu Konfirmasi',
                priority: v('st-priority') || 'Normal',
                completedDate: v('st-status') === 'Selesai' ? (v('st-completedDate') || null) : null,
                evidence: nameArr || null,
                evidencePath: pathArr || null
            };
            this.data.supplierTasks.push(newTask);
            if (window.DTMS && window.DTMS.enabled()) {
                try { await window.DTMS.insertSupplierTask(newTask); }
                catch (e) { console.error(e); alert('Gagal menyimpan tugas ke database.'); }
            }
            this.closeModal('add-task-modal');
            alert(`Tugas ${newId} berhasil dibuat!`);
            document.getElementById('app-layout')?.remove(); this.router();
        };
        if (files && files.length > 0) {
            const fileArr = Array.from(files);
            for (const f of fileArr) {
                if (f.size > 5242880) { alert(`File "${f.name}" melebihi batas maksimal 5MB.`); return; }
            }
            const results = []; let loaded = 0;
            const done = async () => {
                if (loaded < fileArr.length) return;
                const nameArr = results.map(r => r.name);
                const pathArr = results.map(r => r.path);
                await afterRead(null, nameArr, pathArr);
            };
            fileArr.forEach(f => {
                if (window.DTMS && window.DTMS.enabled()) {
                    const path = window.DTMS.makePath('supplierTasks', newId, f.name);
                    window.DTMS.uploadFile('evidence', f, path).then(res => {
                        results.push({ name: f.name, path: res.publicUrl || res.path });
                        loaded++; done();
                    }).catch(err => { console.error(err); loaded++; done(); });
                } else {
                    const reader = new FileReader();
                    reader.onload = e => { results.push({ name: f.name, path: e.target.result }); loaded++; done(); };
                    reader.readAsDataURL(f);
                }
            });
        } else {
            afterRead(null, null, null);
        }
    }

    openEditSupplierTaskModal(taskId) {
        const t = this.data.supplierTasks.find(x => x.id === taskId);
        if (!t) return;
        const modal = document.createElement('div');
        modal.id='edit-task-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        const toolOpts = this.data.toolings.map(x => `<option value="${x.id}" data-supplier="${x.supplier}" data-name="${x.name}" ${x.id===t.toolId?'selected':''}>${x.id} – ${x.name}</option>`).join('');
        const typeOpts = ['Corrective Repair','Preventive','Movement','Disposal Review'].map(x => `<option ${x===t.type?'selected':''}>${x}</option>`).join('');
        const prioOpts = ['Normal','Tinggi'].map(x => `<option ${x===t.priority?'selected':''}>${x}</option>`).join('');
        const statOpts = ['Menunggu Konfirmasi','Sedang Dikerjakan','Selesai','Overdue'].map(x => `<option ${x===t.status?'selected':''}>${x}</option>`).join('');
        const dueVal = t.dueDate&&t.dueDate.includes('-')?t.dueDate:(()=>{try{const d=new Date(t.dueDate);return d.toISOString().split('T')[0]}catch(e){return''}})();
        modal.innerHTML = `<div class="modal-content" style="max-width:540px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-edit" style="color:var(--accent-color);margin-right:0.5rem"></i>Ubah Tugas: ${taskId}</h3><button class="modal-close" onclick="app.closeModal('edit-task-modal')">&times;</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Tooling</label><select id="est-tool" class="form-control" onchange="app._onEditTaskToolChange()">${toolOpts}</select></div><div class="form-group"><label class="form-label">Supplier</label><input type="text" id="est-supplier" class="form-control" value="${t.supplier}" readonly style="background:#f1f5f9"></div><div class="form-group"><label class="form-label">Tipe</label><select id="est-type" class="form-control">${typeOpts}</select></div><div class="form-group"><label class="form-label">Deskripsi</label><textarea id="est-desc" class="form-control" rows="3">${t.description}</textarea></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1rem"><div class="form-group"><label class="form-label">Deadline</label><input type="date" id="est-due" class="form-control" value="${dueVal}" onchange="app._onEditDueDateChange()"></div><div class="form-group"><label class="form-label">Prioritas</label><select id="est-priority" class="form-control">${prioOpts}</select></div></div><div class="form-group"><label class="form-label">Status</label><select id="est-status" class="form-control" onchange="app._toggleCompletedDate('est')">${statOpts}</select></div><div class="form-group" id="est-completedDate-group" style="display:none"><label class="form-label">Tanggal Selesai</label><input type="date" id="est-completedDate" class="form-control" value="${t.completedDate||''}"></div>${t.evidence?`<div class="form-group"><label class="form-label">Evidence yang Ada</label><div class="evidence-file-list">${(Array.isArray(t.evidence)?t.evidence:[t.evidence]).map((name,idx)=>`<div class="evidence-file-item" id="eev-item-${idx}"><i class="fas fa-paperclip" style="margin-right:0.5rem;color:var(--accent-color)"></i><span class="evidence-file-name">${name}</span><button class="evidence-file-remove" onclick="app.removeEditTaskEvidenceFile('${taskId}',${idx})" title="Hapus file">&times;</button></div>`).join('')}</div></div>`:''}<div class="form-group"><label class="form-label">Evidence Selesai</label><input type="file" id="est-evidence" class="form-control" accept=".pdf,.jpg,.jpeg,.png" multiple style="padding:0.375rem"><div id="est-evidence-name" style="margin-top:0.35rem;font-size:0.85rem;color:var(--text-secondary);display:none"><i class="fas fa-paperclip"></i> <span></span></div><div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-secondary)">Format: PDF, JPG, PNG. Maksimal 5MB per file.</div></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('edit-task-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitEditSupplierTask('${taskId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
        this._toggleCompletedDate('est');
        document.getElementById('est-evidence')?.addEventListener('change', function(){
            const fs=this.files;
            const el=document.getElementById('est-evidence-name');
            if(fs&&fs.length>0){
                const names=Array.from(fs).map(f=>f.name).join(', ');
                el.querySelector('span').textContent=fs.length>1?`${fs.length} file: ${names}`:names;
                el.style.display='block';
            }
            else el.style.display='none';
        });
        this._editTaskEvidenceRemoved = [];
    }
    _onEditTaskToolChange() {
        const sel = document.getElementById('est-tool');
        const sup = document.getElementById('est-supplier');
        if (sel && sup) {
            const opt = sel.options[sel.selectedIndex];
            sup.value = opt?.getAttribute('data-supplier') || '';
        }
    }
    _toggleCompletedDate(prefix) {
        const st = document.getElementById(prefix + '-status');
        const group = document.getElementById(prefix + '-completedDate-group');
        if (st && group) {
            group.style.display = st.value === 'Selesai' ? 'block' : 'none';
        }
    }
    _onEditDueDateChange() {
        const statusEl = document.getElementById('est-status');
        const dueEl = document.getElementById('est-due');
        const today = new Date().toLocaleDateString('sv-SE');
        if (statusEl && dueEl && statusEl.value === 'Overdue' && dueEl.value >= today) {
            statusEl.value = 'Sedang Dikerjakan';
            this._toggleCompletedDate('est');
        }
    }
    removeEditTaskEvidenceFile(taskId, fileIndex) {
        if (!this._editTaskEvidenceRemoved) this._editTaskEvidenceRemoved = [];
        this._editTaskEvidenceRemoved.push(fileIndex);
        const item = document.getElementById('eev-item-' + fileIndex);
        if (item) item.remove();
        const list = document.querySelector('#edit-task-modal .evidence-file-list');
        if (list && list.querySelectorAll('.evidence-file-item').length === 0) {
            const group = list.closest('.form-group');
            if (group) group.remove();
        }
    }

    async submitEditSupplierTask(taskId) {
        const t = this.data.supplierTasks.find(x => x.id === taskId);
        if (!t) return;
        const v = id => document.getElementById(id)?.value?.trim();
        const toolSel = document.getElementById('est-tool');
        if (!v('est-desc')) { alert('Harap isi deskripsi.'); return; }
        const toolOpt = toolSel?.options[toolSel.selectedIndex];
        t.toolId = toolSel?.value || t.toolId;
        t.toolName = toolOpt?.getAttribute('data-name') || t.toolName;
        t.supplier = document.getElementById('est-supplier')?.value || t.supplier;
        t.supplierId = this._supplierIdByName(t.supplier);
        t.type = v('est-type') || t.type;
        t.description = v('est-desc') || t.description;
        t.dueDate = v('est-due') || t.dueDate;
        t.priority = v('est-priority') || t.priority;
        t.status = v('est-status') || t.status;
        t.completedDate = v('est-status') === 'Selesai' ? (v('est-completedDate') || null) : null;
        const fileInput = document.getElementById('est-evidence');
        const files = fileInput?.files;
        let currentEvidence = t.evidence && Array.isArray(t.evidence) ? [...t.evidence] : (t.evidence ? [t.evidence] : []);
        let currentPaths = t.evidencePath && Array.isArray(t.evidencePath) ? [...t.evidencePath] : (t.evidencePath ? [t.evidencePath] : []);
        const removed = this._editTaskEvidenceRemoved || [];
        if (removed.length > 0) {
            removed.sort((a, b) => b - a);
            removed.forEach(idx => { currentEvidence.splice(idx, 1); currentPaths.splice(idx, 1); });
        }
        const afterRead = async (nameArr, pathArr) => {
            const allNames = [...currentEvidence, ...(nameArr || [])];
            const allPaths = [...currentPaths, ...(pathArr || [])];
            t.evidence = allNames.length ? (allNames.length === 1 ? allNames[0] : allNames.join(', ')) : null;
            t.evidencePath = allPaths.length ? (allPaths.length === 1 ? allPaths[0] : allPaths.join(', ')) : null;
            delete t.evidenceData;
            if (window.DTMS && window.DTMS.enabled()) {
                try { await window.DTMS.updateSupplierTask(taskId, t); }
                catch (e) { console.error(e); alert('Gagal memperbarui tugas di database.'); }
            }
            this.closeModal('edit-task-modal');
            alert(`Tugas ${taskId} berhasil diperbarui!`);
            document.getElementById('app-layout')?.remove(); this.router();
        };
        if (files && files.length > 0) {
            const fileArr = Array.from(files);
            for (const f of fileArr) {
                if (f.size > 5242880) { alert(`File "${f.name}" melebihi batas maksimal 5MB.`); return; }
            }
            const results = []; let loaded = 0;
            const done = async () => {
                if (loaded < fileArr.length) return;
                const nameArr = results.map(r => r.name);
                const pathArr = results.map(r => r.path);
                await afterRead(nameArr, pathArr);
            };
            fileArr.forEach(f => {
                if (window.DTMS && window.DTMS.enabled()) {
                    const path = window.DTMS.makePath('supplierTasks', taskId, f.name);
                    window.DTMS.uploadFile('evidence', f, path).then(res => {
                        results.push({ name: f.name, path: res.publicUrl || res.path });
                        loaded++; done();
                    }).catch(err => { console.error(err); loaded++; done(); });
                } else {
                    const reader = new FileReader();
                    reader.onload = e => { results.push({ name: f.name, path: e.target.result }); loaded++; done(); };
                    reader.readAsDataURL(f);
                }
            });
        } else {
            await afterRead(null, null);
        }
        this._editTaskEvidenceRemoved = [];
    }

    async deleteSupplierTask(taskId) {
        const idx = this.data.supplierTasks.findIndex(x => x.id === taskId);
        if (idx === -1) return;
        if (!confirm(`Yakin ingin menghapus tugas "${taskId}"?`)) return;
        this.data.supplierTasks.splice(idx, 1);
        if (window.DTMS && window.DTMS.enabled()) {
            try { await window.DTMS.deleteSupplierTask(taskId); }
            catch (e) { console.error(e); alert('Gagal menghapus tugas di database.'); }
        }
        alert(`Tugas ${taskId} berhasil dihapus.`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    // ===== SUPPLIER TASK EVIDENCE =====
    openTaskEvidenceModal(taskId) {
        const t = this.data.supplierTasks.find(x => x.id === taskId);
        if (!t) return;
        const modal = document.createElement('div');
        modal.id = 'task-evidence-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        const existingEvidence = t.evidence && Array.isArray(t.evidence) ? [...t.evidence] : (t.evidence ? [t.evidence] : []);
        const statusBadge = {'Sedang Dikerjakan':'badge-warning','Menunggu Konfirmasi':'badge-info','Selesai':'badge-success','Overdue':'badge-danger'}[t.status]||'badge-secondary';
        let existingHtml = '';
        if (existingEvidence.length > 0) {
            existingHtml = `<div class="form-group"><label class="form-label">Evidence yang Ada</label><div class="evidence-file-list">${existingEvidence.map((name, idx) => `<div class="evidence-file-item" id="ev-item-${idx}"><i class="fas fa-paperclip" style="margin-right:0.5rem;color:var(--accent-color)"></i><span class="evidence-file-name">${name}</span><button class="evidence-file-remove" onclick="app.removeTaskEvidenceFile('${taskId}',${idx})" title="Hapus file">&times;</button></div>`).join('')}</div></div>`;
        }
        modal.innerHTML = `<div class="modal-content" style="max-width:540px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-upload" style="color:var(--accent-color);margin-right:0.5rem"></i>Evidence Selesai - ${taskId}</h3><button class="modal-close" onclick="app.closeModal('task-evidence-modal')">&times;</button></div><div class="modal-body"><div class="task-info-readonly"><div class="info-row"><span class="info-label">ID</span><span class="info-value">${t.id}</span></div><div class="info-row"><span class="info-label">Tooling</span><span class="info-value">${t.toolId} – ${t.toolName}</span></div><div class="info-row"><span class="info-label">Supplier</span><span class="info-value">${t.supplier}</span></div><div class="info-row"><span class="info-label">Tipe</span><span class="info-value">${t.type}</span></div><div class="info-row"><span class="info-label">Deskripsi</span><span class="info-value">${t.description}</span></div><div class="info-row"><span class="info-label">Deadline</span><span class="info-value">${t.dueDate}</span></div><div class="info-row"><span class="info-label">Status</span><span class="info-value"><span class="badge ${statusBadge}">${t.status}</span></span></div></div>${existingHtml}<div class="form-group"><label class="form-label">Upload Evidence</label><input type="file" id="tev-file" class="form-control" accept=".pdf,.jpg,.jpeg,.png" multiple style="padding:0.375rem"><div id="tev-file-name" style="margin-top:0.35rem;font-size:0.85rem;color:var(--text-secondary);display:none"><i class="fas fa-paperclip"></i> <span></span></div><div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-secondary)">Format: PDF, JPG, PNG. Maksimal 5MB per file. Evidence akan digabungkan dengan yang sudah ada.</div></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('task-evidence-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitTaskEvidence('${taskId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        const fileInput = document.getElementById('tev-file');
        const nameEl = document.getElementById('tev-file-name');
        if (fileInput && nameEl) {
            fileInput.addEventListener('change', () => {
                if (fileInput.files.length > 0) {
                    const names = Array.from(fileInput.files).map(f => f.name).join(', ');
                    nameEl.style.display = 'block';
                    nameEl.querySelector('span').textContent = fileInput.files.length > 1 ? `${fileInput.files.length} file: ${names}` : names;
                } else {
                    nameEl.style.display = 'none';
                }
            });
        }
        this._taskEvidenceRemoved = [];
    }

    removeTaskEvidenceFile(taskId, fileIndex) {
        if (!this._taskEvidenceRemoved) this._taskEvidenceRemoved = [];
        this._taskEvidenceRemoved.push(fileIndex);
        const item = document.getElementById('ev-item-' + fileIndex);
        if (item) item.remove();
        const list = document.querySelector('#task-evidence-modal .evidence-file-list');
        if (list && list.querySelectorAll('.evidence-file-item').length === 0) {
            const group = list.closest('.form-group');
            if (group) group.remove();
        }
    }

    async submitTaskEvidence(taskId) {
        const t = this.data.supplierTasks.find(x => x.id === taskId);
        if (!t) return;
        const fileInput = document.getElementById('tev-file');
        const files = fileInput?.files;
        let currentEvidence = t.evidence && Array.isArray(t.evidence) ? [...t.evidence] : (t.evidence ? [t.evidence] : []);
        let currentPaths = t.evidencePath && Array.isArray(t.evidencePath) ? [...t.evidencePath] : (t.evidencePath ? [t.evidencePath] : []);
        const removed = this._taskEvidenceRemoved || [];
        if (removed.length > 0) {
            removed.sort((a, b) => b - a);
            removed.forEach(idx => { currentEvidence.splice(idx, 1); currentPaths.splice(idx, 1); });
        }
        const afterRead = async (nameArr, pathArr) => {
            const allNames = [...currentEvidence, ...(nameArr || [])];
            const allPaths = [...currentPaths, ...(pathArr || [])];
            t.evidence = allNames.length ? (allNames.length === 1 ? allNames[0] : allNames.join(', ')) : null;
            t.evidencePath = allPaths.length ? (allPaths.length === 1 ? allPaths[0] : allPaths.join(', ')) : null;
            delete t.evidenceData;
            if (window.DTMS && window.DTMS.enabled()) {
                try { await window.DTMS.updateSupplierTask(taskId, t); }
                catch (e) { console.error(e); alert('Gagal menyimpan evidence ke database.'); }
            }
            this.closeModal('task-evidence-modal');
            alert('Evidence berhasil disimpan!');
            document.getElementById('app-layout')?.remove();
            this.router();
        };
        if (files && files.length > 0) {
            const fileArr = Array.from(files);
            for (const f of fileArr) {
                if (f.size > 5242880) { alert(`File "${f.name}" melebihi batas maksimal 5MB.`); return; }
            }
            const results = []; let loaded = 0;
            const done = async () => {
                if (loaded < fileArr.length) return;
                const nameArr = results.map(r => r.name);
                const pathArr = results.map(r => r.path);
                await afterRead(nameArr, pathArr);
            };
            fileArr.forEach(f => {
                if (window.DTMS && window.DTMS.enabled()) {
                    const path = window.DTMS.makePath('supplierTasks', taskId, f.name);
                    window.DTMS.uploadFile('evidence', f, path).then(res => {
                        results.push({ name: f.name, path: res.publicUrl || res.path });
                        loaded++; done();
                    }).catch(err => { console.error(err); loaded++; done(); });
                } else {
                    const reader = new FileReader();
                    reader.onload = e => { results.push({ name: f.name, path: e.target.result }); loaded++; done(); };
                    reader.readAsDataURL(f);
                }
            });
        } else {
            await afterRead(null, null);
        }
        this._taskEvidenceRemoved = [];
    }

    openTaskEvidence(taskId) {
        const t = this.data.supplierTasks.find(x => x.id === taskId);
        const urls = t?.evidencePath ? (Array.isArray(t.evidencePath) ? [...t.evidencePath] : [t.evidencePath]) : [];
        if (urls.length === 0 && t?.evidenceData) {
            // Legacy fallback for old in-memory data
            const data = Array.isArray(t.evidenceData) ? t.evidenceData : [t.evidenceData];
            const names = Array.isArray(t.evidence) ? t.evidence : [];
            if (data.length === 1) {
                const w = window.open('', '_blank');
                w.document.write(`<html><head><title>Evidence - ${taskId}</title><style>body{margin:0;height:100vh}iframe{width:100%;height:100%;border:0}</style></head><body><iframe src="${data[0]}"></iframe></body></html>`);
                w.document.close();
                return;
            }
            const w = window.open('', '_blank');
            const tabs = data.map((d, i) => {
                const n = names[i] || `File ${i + 1}`;
                return `<button onclick="document.querySelectorAll('iframe').forEach(f=>f.style.display='none');document.getElementById('f${i}').style.display='block';document.querySelectorAll('.tab-btn').forEach(b=>b.style.background='');this.style.background='#2563eb';this.style.color='#fff'" class="tab-btn" style="padding:8px 16px;border:1px solid #ccc;cursor:pointer;border-radius:6px 6px 0 0;background:#f1f5f9;font-size:13px">${n}</button>`;
            }).join('');
            const iframes = data.map((d, i) => `<iframe id="f${i}" src="${d}" style="width:100%;height:100%;border:0;${i > 0 ? 'display:none' : ''}"></iframe>`).join('');
            w.document.write(`<html><head><title>Evidence - ${taskId}</title><style>body{margin:0;display:flex;flex-direction:column;height:100vh}nav{padding:8px;background:#f8fafc;border-bottom:1px solid #ccc;display:flex;gap:4px}.tab-btn:first-child{background:#2563eb;color:#fff}</style></head><body><nav>${tabs}</nav><div style="flex:1">${iframes}</div></body></html>`);
            w.document.close();
            return;
        }
        if (urls.length > 0) {
            const names = t.evidence ? (Array.isArray(t.evidence) ? [...t.evidence] : [t.evidence]) : urls.map((_, i) => `File ${i + 1}`);
            if (urls.length === 1) {
                window.open(urls[0], '_blank');
                return;
            }
            const w = window.open('', '_blank');
            const tabs = urls.map((d, i) => {
                const n = names[i] || `File ${i + 1}`;
                return `<button onclick="document.querySelectorAll('iframe').forEach(f=>f.style.display='none');document.getElementById('f${i}').style.display='block';document.querySelectorAll('.tab-btn').forEach(b=>b.style.background='');this.style.background='#2563eb';this.style.color='#fff'" class="tab-btn" style="padding:8px 16px;border:1px solid #ccc;cursor:pointer;border-radius:6px 6px 0 0;background:#f1f5f9;font-size:13px">${n}</button>`;
            }).join('');
            const iframes = urls.map((d, i) => `<iframe id="f${i}" src="${d}" style="width:100%;height:100%;border:0;${i > 0 ? 'display:none' : ''}"></iframe>`).join('');
            w.document.write(`<html><head><title>Evidence - ${taskId}</title><style>body{margin:0;display:flex;flex-direction:column;height:100vh}nav{padding:8px;background:#f8fafc;border-bottom:1px solid #ccc;display:flex;gap:4px}.tab-btn:first-child{background:#2563eb;color:#fff}</style></head><body><nav>${tabs}</nav><div style="flex:1">${iframes}</div></body></html>`);
            w.document.close();
            return;
        }
        window.open('evidence/dummy.pdf', '_blank');
    }

    // ===== REPORTS MODULE =====
    getReportsView() {
        document.getElementById('header-title').innerText = 'Laporan & KPI';
        const t = this.data.toolings, logs = this.data.maintenanceLogs||[];
        const cnt = (arr,key) => { const m={}; arr.forEach(i=>{m[i[key]]=(m[i[key]]||0)+1}); return m; };
        const sc=cnt(t,'status'), cc=cnt(t,'condition'), supc=cnt(t,'supplier'), typc=cnt(t,'type');
        const total=t.length, prev=logs.filter(l=>l.type==='Preventive').length, corr=logs.length-prev, done=logs.filter(l=>l.status==='Selesai').length;
        const sLogs=this.data.shootLogs||[], dLogs=this.data.deliveryLogs||[];
        let sumLife=0,sumReject=0,kpiCount=0,sisaDepCount=0;
        t.forEach(tool=>{
            const cumShoot=sLogs.filter(s=>s.toolId===tool.id).reduce((s,l)=>s+(l.shootCount||0),0);
            const maxShoot=parseInt(tool.maxShoot)||1;
            sumLife+=(cumShoot/maxShoot)*100;
            const matched=dLogs.filter(l=>l.toolId===tool.id);
            const matchedQtyOk=matched.reduce((s,l)=>s+(l.qtyOk||0),0);
            const qtyPer=parseInt((tool.qtyPerTooling||'1').replace(/,/g,''))||1;
            sumReject+=cumShoot>0?((1-matchedQtyOk/(cumShoot*qtyPer))*100):0;
            const qtyDep=parseInt((tool.qtyDepreciation||'').replace(/,/g,''))||0;
            const totalOk=matched.reduce((s,l)=>s+(l.qtyOk||0),0);
            if(qtyDep-totalOk>0)sisaDepCount++;
            kpiCount++;
        });
        const avgLifeRatio=kpiCount>0?(sumLife/kpiCount).toFixed(1):'0';
        const avgRejectRatio=kpiCount>0?(sumReject/kpiCount).toFixed(1):'0';
        const sCol={'Aktif':'#10b981','Dalam Perbaikan':'#f59e0b','Tidak Aktif':'#64748b'};
        const cCol={'Baik':'#10b981','Perlu Perbaikan':'#f59e0b','NG':'#ef4444'};
        const bar=(l,v,mx,c)=>`<div style="margin-bottom:0.75rem"><div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:0.25rem"><span>${l}</span><span class="font-semibold">${v}</span></div><div style="width:100%;height:8px;background:var(--border-color);border-radius:4px"><div style="width:${mx?(v/mx*100):0}%;height:100%;background:${c};border-radius:4px;transition:width .5s"></div></div></div>`;
        const chartCard=(title,content)=>`<div class="card"><div class="card-header"><h3 class="card-title">${title}</h3></div><div class="card-body">${content}</div></div>`;
        return `<div class="reports-view"><div class="kpi-grid kpi-dashboard"><div class="kpi-card kpi-total"><div class="kpi-icon dark"><i class="fas fa-cubes"></i></div><div class="kpi-content"><span class="kpi-title">Total Tooling</span><div class="kpi-value">${total}</div></div></div><div class="kpi-card"><div class="kpi-icon blue"><i class="fas fa-truck"></i></div><div class="kpi-content"><span class="kpi-title">Supplier Aktif</span><div class="kpi-value">${Object.keys(supc).length}</div></div></div><div class="kpi-card"><div class="kpi-icon green"><i class="fas fa-heartbeat"></i></div><div class="kpi-content"><span class="kpi-title">Rata-rata Life Tool Ratio</span><div class="kpi-value">${avgLifeRatio}%</div></div></div><div class="kpi-card"><div class="kpi-icon blue"><i class="fas fa-calculator"></i></div><div class="kpi-content"><span class="kpi-title">Tooling dgn Sisa Depresiasi</span><div class="kpi-value">${sisaDepCount}</div></div></div><div class="kpi-card"><div class="kpi-icon orange"><i class="fas fa-exclamation-triangle"></i></div><div class="kpi-content"><span class="kpi-title">Rata-rata Reject Ratio</span><div class="kpi-value">${avgRejectRatio}%</div></div></div></div><div class="grid-2" style="margin-bottom:1rem">${chartCard('Status Tooling',Object.entries(sc).map(([k,v])=>bar(k,v,total,sCol[k]||'#64748b')).join(''))}${chartCard('Kondisi Tooling',Object.entries(cc).map(([k,v])=>bar(k,v,total,cCol[k]||'#64748b')).join(''))}${chartCard('Per Supplier',Object.entries(supc).map(([k,v])=>bar(k,v,total,'#2563eb')).join(''))}${chartCard('Per Tipe',Object.entries(typc).map(([k,v])=>bar(k,v,total,'#8b5cf6')).join(''))}${chartCard('Tipe Maintenance',bar('Preventive',prev,logs.length||1,'#10b981')+bar('Corrective',corr,logs.length||1,'#f59e0b'))}${chartCard('Status Maintenance',bar('Selesai',done,logs.length||1,'#10b981')+bar('Pending',logs.length-done,logs.length||1,'#f59e0b'))}</div></div>`;
    }

    // ===== ADMIN MODULE =====
    getAdminView() {
        document.getElementById('header-title').innerText = 'Pengaturan Admin';
        const u=this.data.users, al=this.data.auditLogs||[];
        const uRows=u.map(x=>`<tr><td>${x.id}</td><td class="font-semibold">${x.username}</td><td>${x.name}</td><td>${x.company||'-'}</td><td><span class="badge badge-info">${x.role}</span></td><td><button class="btn btn-sm btn-secondary" onclick="app.openEditUserModal(${x.id})" title="Edit" style="padding:0.25rem 0.5rem;margin-right:0.25rem"><i class="fas fa-edit"></i></button>${x.username!=='admin'?`<button class="btn btn-sm btn-danger" onclick="app.submitDeleteUser(${x.id})" title="Hapus" style="padding:0.25rem 0.5rem"><i class="fas fa-trash"></i></button>`:''}</td></tr>`).join('');
        const auditList=al.map(a=>`<div style="display:flex;gap:0.75rem;padding:0.75rem 0;border-bottom:1px solid var(--border-color)"><div style="width:32px;height:32px;border-radius:50%;background:${a.color}15;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas ${a.icon}" style="color:${a.color};font-size:0.75rem"></i></div><div style="flex:1"><div style="font-size:0.85rem">${a.action}</div><div style="font-size:0.75rem;color:var(--text-secondary)">${a.user} · ${a.time}</div></div></div>`).join('');
        return `<div class="grid-2-1"><div><div class="card"><div class="card-header"><h3 class="card-title">Manajemen Pengguna</h3><button class="btn btn-primary" onclick="app.openAddUserModal()"><i class="fas fa-plus"></i> Tambah Pengguna</button></div><div class="table-responsive"><table class="table"><thead><tr><th>ID</th><th>Username</th><th>Nama</th><th>Perusahaan</th><th>Role</th><th>Aksi</th></tr></thead><tbody>${uRows}</tbody></table></div></div><div class="card mt-4"><div class="card-header"><h3 class="card-title">Log Aktivitas Sistem</h3></div><div class="card-body" style="padding:1rem 1.25rem">${auditList}</div></div></div><div><div class="card"><div class="card-header"><h3 class="card-title">Info Sistem</h3></div><div class="card-body"><div class="info-item mb-4"><span class="info-label">Versi</span><span class="info-value">1.0.0 MVP</span></div><div class="info-item mb-4"><span class="info-label">Tooling</span><span class="info-value">${this.data.toolings.length} data</span></div><div class="info-item mb-4"><span class="info-label">User</span><span class="info-value">${u.length} pengguna</span></div></div></div></div></div>`;
    }

    // ===== NOTIFICATIONS =====
    toggleNotifications() {
        const p = document.getElementById('notification-panel');
        if (!p) return;
        if (p.style.display === 'none') {
            const n = this.data.notifications || [];
            p.innerHTML = `<div style="padding:1rem;border-bottom:1px solid var(--border-color);font-weight:600;font-size:0.9rem">Notifikasi</div>${n.map(x=>`<div style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);font-size:0.85rem;background:${x.read?'white':'#eff6ff'};cursor:pointer"><div>${x.message}</div><div style="font-size:0.7rem;color:var(--text-secondary);margin-top:0.25rem">${x.time}</div></div>`).join('')}${n.length===0?'<div style="padding:2rem;text-align:center;color:var(--text-secondary)">Tidak ada notifikasi</div>':''}`;
            p.style.display = 'block';
        } else { p.style.display = 'none'; }
    }

    // ===== FILTER =====
    toggleFilter() {
        let fp = document.getElementById('filter-panel');
        if (fp) { fp.remove(); return; }
        const statuses = ['Aktif','Tidak Aktif','Dalam Perbaikan'];
        const types = [...new Set(this.data.toolings.map(t=>t.type))];
        const conditions = ['Baik','Perlu Perbaikan','NG'];
        const chkGroup = (id,label,opts) => {
            const allId = `chk_${id}_all`;
            const items = opts.map(o => {
                const cid = `chk_${id}_${o.replace(/\s+/g,'_')}`;
                return `<label class="filter-check-label"><input type="checkbox" id="${cid}" value="${o}" checked onchange="app.applyFilter()"> ${o}</label>`;
            }).join('');
            return `<div class="filter-group"><label class="form-label">${label}</label><div class="filter-check-group"><label class="filter-check-label filter-check-all"><input type="checkbox" id="${allId}" checked onchange="app.toggleFilterAll('${id}',this)"> Semua</label>${items}</div></div>`;
        };
        const tb = document.querySelector('.table-toolbar');
        if(!tb) return;
        tb.insertAdjacentHTML('afterend', `<div id="filter-panel">${chkGroup('fType','Tipe',types)}${chkGroup('fStatus','Status',statuses)}${chkGroup('fKondisi','Kondisi',conditions)}</div>`);
    }
    toggleFilterAll(groupId, allCheckbox) {
        const panel = document.getElementById('filter-panel');
        if (!panel) return;
        const checked = allCheckbox.checked;
        panel.querySelectorAll(`input[id^="chk_${groupId}_"]:not([id$="_all"])`).forEach(cb => {
            cb.checked = checked;
        });
        this.applyFilter();
    }
    getFilterSelected(id) {
        const panel = document.getElementById('filter-panel');
        if (!panel) return [];
        const selected = [];
        panel.querySelectorAll(`input[id^="chk_${id}_"]:not([id$="_all"]):checked`).forEach(cb => {
            selected.push(cb.value);
        });
        return selected;
    }
    syncAllCheckbox(groupId) {
        const panel = document.getElementById('filter-panel');
        if (!panel) return;
        const allCb = document.getElementById(`chk_${groupId}_all`);
        if (!allCb) return;
        const items = panel.querySelectorAll(`input[id^="chk_${groupId}_"]:not([id$="_all"])`);
        const allChecked = items.length > 0 && Array.from(items).every(cb => cb.checked);
        allCb.checked = allChecked;
    }
    applyFilter() {
        this.syncAllCheckbox('fStatus');
        this.syncAllCheckbox('fType');
        this.syncAllCheckbox('fKondisi');
        const stSelected = this.getFilterSelected('fStatus');
        const tySelected = this.getFilterSelected('fType');
        const knSelected = this.getFilterSelected('fKondisi');
        const panel = document.getElementById('filter-panel');
        document.querySelectorAll('#toolingTable tbody tr').forEach(row=>{
            const rowStatus = row.getAttribute('data-status') || '';
            const rowType = row.getAttribute('data-type') || '';
            const rowKondisi = row.getAttribute('data-condition') || '';
            const stMatch = !panel || stSelected.some(v => rowStatus === v);
            const tyMatch = !panel || tySelected.some(v => rowType === v);
            const knMatch = !panel || knSelected.some(v => rowKondisi === v);
            row.style.display = (stMatch && tyMatch && knMatch) ? '' : 'none';
        });
        this.updateRowNumbers();
    }

    updateRowNumbers() {
        const rows = document.querySelectorAll('#toolingTable tbody tr');
        let num = 1;
        rows.forEach(row => {
            if (row.style.display !== 'none') {
                const td = row.querySelector('td');
                if (td) td.textContent = num++;
            }
        });
    }

    // ===== SUPPLIER TASKS FILTER =====
    supplierTaskFilterKey = 'dtms-supplier-task-filter-state';

    getSupplierTaskFilterDefaults() {
        return {
            stStatus: ['Menunggu Konfirmasi', 'Sedang Dikerjakan', 'Selesai', 'Overdue'],
            stPriority: ['Normal', 'Tinggi']
        };
    }

    loadSupplierTaskFilterState() {
        try {
            const raw = localStorage.getItem(this.supplierTaskFilterKey);
            if (raw) return JSON.parse(raw);
        } catch (e) { console.warn('Gagal memuat state filter:', e); }
        return this.getSupplierTaskFilterDefaults();
    }

    saveSupplierTaskFilterState() {
        try {
            const state = {
                stStatus: this.getSupplierTaskFilterSelected('stStatus'),
                stPriority: this.getSupplierTaskFilterSelected('stPriority')
            };
            localStorage.setItem(this.supplierTaskFilterKey, JSON.stringify(state));
        } catch (e) { console.warn('Gagal menyimpan state filter:', e); }
    }

    resetSupplierTaskFilter() {
        const panel = document.getElementById('supplier-task-filter-panel');
        if (!panel) return;
        const defaults = this.getSupplierTaskFilterDefaults();
        ['stStatus', 'stPriority'].forEach(groupId => {
            panel.querySelectorAll(`input[id^="chk_st_${groupId}_"]:not([id$="_all"])`).forEach(cb => {
                cb.checked = defaults[groupId].includes(cb.value);
            });
        });
        this.applySupplierTaskFilter();
    }

    toggleSupplierTaskFilter() {
        let fp = document.getElementById('supplier-task-filter-panel');
        if (fp) { fp.remove(); return; }
        const statuses = ['Menunggu Konfirmasi', 'Sedang Dikerjakan', 'Selesai', 'Overdue'];
        const priorities = ['Normal', 'Tinggi'];
        const state = this.loadSupplierTaskFilterState();
        const chkGroup = (id, label, opts) => {
            const allId = `chk_st_${id}_all`;
            const selected = state[id] || opts;
            const items = opts.map(o => {
                const cid = `chk_st_${id}_${o.replace(/\s+/g, '_')}`;
                const checked = selected.includes(o) ? 'checked' : '';
                return `<label class="filter-check-label"><input type="checkbox" id="${cid}" value="${o}" ${checked} onchange="app.applySupplierTaskFilter()"> ${o}</label>`;
            }).join('');
            return `<div class="filter-group"><label class="form-label">${label}</label><div class="filter-check-group"><label class="filter-check-label filter-check-all"><input type="checkbox" id="${allId}" checked onchange="app.toggleSupplierTaskFilterAll('${id}',this)"> Semua</label>${items}</div></div>`;
        };
        const tb = document.querySelector('.table-toolbar');
        if (!tb) return;
        tb.insertAdjacentHTML('afterend', `<div id="supplier-task-filter-panel"><div class="filter-actions" style="display:flex;justify-content:flex-end;margin-bottom:0.5rem"><button type="button" class="btn btn-sm btn-secondary" onclick="app.resetSupplierTaskFilter()"><i class="fas fa-undo"></i> Reset Filter</button></div>${chkGroup('stStatus', 'Status', statuses)}${chkGroup('stPriority', 'Prioritas', priorities)}</div>`);
        this.applySupplierTaskFilter();
    }

    toggleSupplierTaskFilterAll(groupId, allCheckbox) {
        const panel = document.getElementById('supplier-task-filter-panel');
        if (!panel) return;
        const checked = allCheckbox.checked;
        panel.querySelectorAll(`input[id^="chk_st_${groupId}_"]:not([id$="_all"])`).forEach(cb => {
            cb.checked = checked;
        });
        this.applySupplierTaskFilter();
    }

    getSupplierTaskFilterSelected(id) {
        const panel = document.getElementById('supplier-task-filter-panel');
        if (!panel) return [];
        const selected = [];
        panel.querySelectorAll(`input[id^="chk_st_${id}_"]:not([id$="_all"]):checked`).forEach(cb => {
            selected.push(cb.value);
        });
        return selected;
    }

    syncSupplierTaskFilterAll(groupId) {
        const panel = document.getElementById('supplier-task-filter-panel');
        if (!panel) return;
        const allCb = document.getElementById(`chk_st_${groupId}_all`);
        if (!allCb) return;
        const items = panel.querySelectorAll(`input[id^="chk_st_${groupId}_"]:not([id$="_all"])`);
        const allChecked = items.length > 0 && Array.from(items).every(cb => cb.checked);
        allCb.checked = allChecked;
    }

    applySupplierTaskFilter() {
        this.syncSupplierTaskFilterAll('stStatus');
        this.syncSupplierTaskFilterAll('stPriority');
        this.saveSupplierTaskFilterState();
        const stSelected = this.getSupplierTaskFilterSelected('stStatus');
        const prSelected = this.getSupplierTaskFilterSelected('stPriority');
        const panel = document.getElementById('supplier-task-filter-panel');
        document.querySelectorAll('#supplierTasksTable tbody tr').forEach(row => {
            const rowStatus = row.getAttribute('data-status') || '';
            const rowPriority = row.getAttribute('data-priority') || '';
            const stMatch = !panel || stSelected.some(v => rowStatus === v);
            const prMatch = !panel || prSelected.some(v => rowPriority === v);
            row.style.display = (stMatch && prMatch) ? '' : 'none';
        });
        this.updateSupplierTaskRowNumbers();
    }

    updateSupplierTaskRowNumbers() {
        const rows = document.querySelectorAll('#supplierTasksTable tbody tr');
        let num = 1;
        rows.forEach(row => {
            if (row.style.display !== 'none') {
                const td = row.querySelector('td');
                if (td) td.textContent = num++;
            }
        });
    }

    // ===== EXPORT EXCEL =====
    exportToolingExcel() {
        const h=['No. Urut','ID Tooling','Nama Tooling','Tipe','Part Number','Nama Part','Model','Supplier','Nama PIC','Alamat Supplier','Status','Kondisi','Harga','Kepemilikan','Maker','QTY per Shoot','Tonnase','Material Tooling','Berat Tooling','Dimensi Utama (PxLxT)','Maximum Shoot','Kumulatif Shoot','Life Tool Ratio','Kumulatif Total Kirim','Kumulatif QTY OK','Total Reject Ratio','Periode Depresiasi','QTY Depresiasi','Sisa QTY Depresiasi'];
        let toolings=this.data.toolings;
        if(this.currentUser.role==='Pengguna Supplier'){toolings=toolings.filter(t=>t.supplier===this.currentUser.name);}
        const rows=toolings.map((t,i)=>{
            const shootLogs=(this.data.shootLogs||[]).filter(sl=>sl.toolId===t.id);
            const cumShoot=shootLogs.reduce((sum,sl)=>sum+sl.shootCount,0);
            const deliveryLogs=(this.data.deliveryLogs||[]).filter(l=>l.toolId===t.id);
            const totalKirim=deliveryLogs.reduce((sum,l)=>sum+(typeof l.qtyDelivered==='number'?l.qtyDelivered:0),0);
            const totalQtyOk=deliveryLogs.reduce((sum,l)=>sum+(l.qtyOk||0),0);
            const qtyPerTooling=parseInt(t.qtyPerTooling)||1;
            const matchedLogs=deliveryLogs.filter(l=>shootLogs.some(s=>s.month===l.month));
            const matchedQtyOk=matchedLogs.reduce((sum,l)=>sum+(l.qtyOk||0),0);
            const rejectRatio=cumShoot>0?((1-matchedQtyOk/(cumShoot*qtyPerTooling))*100):0;
            const qtyDep=parseInt((t.qtyDepreciation||'').replace(/,/g,''))||0;
            const sisa=qtyDep-totalQtyOk;
            const lifeRatio=(cumShoot/(parseInt(t.maxShoot)||1)*100).toFixed(1);
            return [
                i+1,t.id,t.name,t.type,t.partNumber,t.partName||'-',t.model,t.supplier,t.pic||'-',t.supplierAddress||'-',
                t.status,t.condition,t.price||'-',t.owner||'-',t.maker||'-',t.qtyPerTooling||'1',
                t.tonnage||'-',t.material||'-',t.weight||'-',t.dimensions||'-',
                parseInt(t.maxShoot)||0,cumShoot,lifeRatio+'%',
                totalKirim,totalQtyOk,rejectRatio.toFixed(1)+'%',
                (t.depreciationType||'')+' '+(t.depreciationValue||'-'),qtyDep,sisa>=0?sisa:'Depresiasi selesai'
            ];
        });
        const ws=XLSX.utils.aoa_to_sheet([h,...rows]);
        ws['!cols']=h.map((_,i)=>{
            const w=[6,14,22,16,14,12,10,18,12,40,16,18,18,14,22,22,16,10,18,16,22,16,18,16,18,18,18,20,16,18];
            return {wch:w[i]||14};
        });
        const wb=XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb,ws,'Register Induk Tooling');
        XLSX.writeFile(wb,'register_induk_tooling.xlsx');
    }

    // ===== IMPORT EXCEL =====
    openImportToolingModal() {
        const modal=document.createElement('div');
        modal.id='import-tooling-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        modal.innerHTML=`<div class="modal-content" style="max-width:480px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-file-import" style="color:var(--accent-color);margin-right:0.5rem"></i>Impor Data Tooling</h3><button class="modal-close" onclick="app.closeModal('import-tooling-modal')">&times;</button></div><div class="modal-body"><p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:1rem">Gunakan format Excel yang sama dengan hasil Ekspor. Baris dengan ID yang sudah ada akan dilewati.</p><div class="form-group"><button class="btn btn-secondary" onclick="app.downloadToolingTemplate()"><i class="fas fa-download"></i> Unduh Template</button></div><div class="form-group"><label class="form-label">File Excel (.xlsx/.xls)</label><input type="file" id="it-file" class="form-control" accept=".xlsx,.xls" onchange="app.importToolingExcel()"></div><div id="it-result" style="margin-top:1rem;font-size:0.875rem"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('import-tooling-modal')">Tutup</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
    }

    downloadToolingTemplate() {
        const h=['No. Urut','ID Tooling','Nama Tooling','Tipe','Part Number','Nama Part','Model','Supplier','Nama PIC','Alamat Supplier','Status','Kondisi','Harga','Kepemilikan','Maker','QTY per Shoot','Tonnase','Material Tooling','Berat Tooling','Dimensi Utama (PxLxT)','Maximum Shoot','Kumulatif Shoot','Life Tool Ratio','Kumulatif Total Kirim','Kumulatif QTY OK','Total Reject Ratio','Periode Depresiasi','QTY Depresiasi','Sisa QTY Depresiasi'];
        const rows=[
            [1,'T-2026-001','Contoh Tooling A','Stamping Die','PN-001','Nama Part A','Model A','PT Supplier A','Ahmad','Jl. Contoh No.1','Aktif','Baik','Rp 100.000.000','Milik MII','PT Maker A','1','1.200 Ton','SKD11','2.500 kg','1200 x 600 x 800 mm','1000000','0','0%','0','0','0%','Tahun 5','500000','500000'],
            [2,'T-2026-002','Contoh Tooling B','Casting Die','PN-002','Nama Part B','Model B','PT Supplier B','Budi','Jl. Contoh No.2','Aktif','Baik','Rp 150.000.000','Milik Supplier','PT Maker B','1','800 Ton','P20','1.800 kg','1000 x 500 x 700 mm','800000','0','0%','0','0','0%','Tahun 7','700000','700000']
        ];
        const ws=XLSX.utils.aoa_to_sheet([h,...rows]);
        ws['!cols']=h.map((_,i)=>{return {wch:16};});
        const wb=XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb,ws,'Template Tooling');
        XLSX.writeFile(wb,'template_register_induk_tooling.xlsx');
    }

    async importToolingExcel() {
        const fileInput=document.getElementById('it-file');
        const resultEl=document.getElementById('it-result');
        if(!fileInput||!fileInput.files||fileInput.files.length===0)return;
        const file=fileInput.files[0];
        const data=await file.arrayBuffer();
        let wb;
        try{wb=XLSX.read(data,{type:'array'});}catch(e){resultEl.innerHTML=`<span style="color:var(--danger-color)">Gagal membaca file: ${e.message}</span>`;return;}
        const ws=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
        if(rows.length<2){resultEl.innerHTML='<span style="color:var(--danger-color)">File kosong atau tidak memiliki data.</span>';return;}
        const headers=rows[0].map(h=>String(h).trim());
        const col=(label)=>headers.indexOf(label);
        let success=0, errors=[];
        for(let i=1;i<rows.length;i++){
            const r=rows[i];
            const id=String(r[col('ID Tooling')]||'').trim();
            const name=String(r[col('Nama Tooling')]||'').trim();
            const type=String(r[col('Tipe')]||'').trim();
            if(!id&&!name&&!type) continue;
            if(!id||!name||!type){errors.push(`Baris ${i+1}: ID, Nama, dan Tipe wajib diisi.`);continue;}
            if(this.data.toolings.some(t=>t.id===id)){errors.push(`Baris ${i+1}: ID "${id}" sudah ada.`);continue;}
            const periode=String(r[col('Periode Depresiasi')]||'').trim();
            let depreciationType='', depreciationValue='';
            if(periode){const sp=periode.indexOf(' ');if(sp>0){depreciationType=periode.slice(0,sp);depreciationValue=periode.slice(sp+1);}else{depreciationType=periode;}}
            const obj={
                id,
                name,
                type,
                partNumber:String(r[col('Part Number')]||'').trim(),
                partName:String(r[col('Nama Part')]||'').trim(),
                model:String(r[col('Model')]||'').trim(),
                supplier:String(r[col('Supplier')]||'').trim(),
                pic:String(r[col('Nama PIC')]||'').trim(),
                supplierAddress:String(r[col('Alamat Supplier')]||'').trim(),
                status:String(r[col('Status')]||'Aktif').trim(),
                condition:String(r[col('Kondisi')]||'Baik').trim(),
                price:String(r[col('Harga')]||'').trim(),
                owner:String(r[col('Kepemilikan')]||'').trim(),
                maker:String(r[col('Maker')]||'').trim(),
                qtyPerTooling:String(r[col('QTY per Shoot')]||'1').trim(),
                tonnage:String(r[col('Tonnase')]||'').trim(),
                material:String(r[col('Material Tooling')]||'').trim(),
                weight:String(r[col('Berat Tooling')]||'').trim(),
                dimensions:String(r[col('Dimensi Utama (PxLxT)')]||'').trim(),
                maxShoot:parseInt(r[col('Maximum Shoot')]||0)||0,
                depreciationType,
                depreciationValue,
                qtyDepreciation:String(r[col('QTY Depresiasi')]||'').trim()
            };
            try{
                if(window.DTMS && window.DTMS.enabled()){
                    await window.DTMS.insertTooling(obj);
                }
                this.data.toolings.push(obj);
                success++;
            }catch(e){console.error(e);errors.push(`Baris ${i+1}: Gagal menyimpan "${id}".`);}
        }
        const errHtml=errors.length>0?`<details style="margin-top:0.5rem"><summary style="color:var(--danger-color);cursor:pointer">${errors.length} error</summary><ul style="margin-top:0.5rem;padding-left:1.25rem;color:var(--text-secondary)">${errors.map(e=>`<li>${e}</li>`).join('')}</ul></details>`:'';
        resultEl.innerHTML=`<span style="color:var(--success-color)">${success} data berhasil diimport.</span>${errHtml}`;
        if(success>0){setTimeout(()=>{this.closeModal('import-tooling-modal');document.getElementById('app-layout')?.remove();this.router();},1500);}
    }

    // ===== MOVEMENT MODAL =====
    openMovementModal(toolId, toolName) {
        const modal = document.createElement('div');
        modal.id='movement-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        modal.innerHTML=`<div class="modal-content" style="max-width:500px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-exchange-alt" style="color:var(--accent-color);margin-right:0.5rem"></i>Pindahkan Tooling</h3><button class="modal-close" onclick="app.closeModal('movement-modal')">&times;</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Tooling</label><input class="form-control" value="${toolId} – ${toolName}" readonly style="background:#f1f5f9"></div><div class="form-group"><label class="form-label">Lokasi Tujuan <span style="color:var(--danger-color)">*</span></label><input type="text" id="mv-dest" class="form-control" placeholder="Masukkan lokasi tujuan..."></div><div class="form-group"><label class="form-label">Alasan Pemindahan <span style="color:var(--danger-color)">*</span></label><textarea id="mv-reason" class="form-control" rows="3" placeholder="Jelaskan alasan pemindahan..."></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('movement-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitMovement('${toolId}')"><i class="fas fa-paper-plane"></i> Submit</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
    }
    async submitMovement(toolId) {
        const dest=document.getElementById('mv-dest')?.value, reason=document.getElementById('mv-reason')?.value?.trim();
        if(!reason){alert('Harap isi alasan pemindahan.');return;}
        const t=this.data.toolings.find(x=>x.id===toolId);
        const newLog={id:`MV-${Date.now()}`,toolId,toolName:t?.name||'',fromLocation:'-',toLocation:dest,date:new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}),reason,status:'Menunggu Persetujuan',requestedBy:this.currentUser.name};
        this.data.movementLogs.unshift(newLog);
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.insertMovementLog(newLog);}catch(e){console.error(e);alert('Gagal menyimpan pergerakan ke database.');}
        }
        this.closeModal('movement-modal'); alert(`Permintaan pemindahan ${toolId} ke ${dest} berhasil diajukan!`); window.location.hash=`#tooling/${toolId}`; this.router();
    }

    // ===== ADD TOOLING MODAL =====
    openAddToolingModal() {
        if (!this.currentUser.role.includes('Admin')) return;
        const modal = document.createElement('div');
        modal.id='add-tooling-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        const fg=(id,lbl,ph,type)=>`<div class="form-group"><label class="form-label">${lbl}</label><input type="${type||'text'}" id="at-${id}" class="form-control" placeholder="${ph}"></div>`;
        const fgNum=(id,lbl,ph)=>`<div class="form-group"><label class="form-label">${lbl}</label><input id="at-${id}" class="form-control" type="text" placeholder="${ph||''}"></div>`;
        const statOpts=['Aktif','Dalam Perbaikan','Tidak Aktif'].map(s=>`<option>${s}</option>`).join('');
        const condOpts=['Baik','Perlu Perbaikan','NG'].map(c=>`<option>${c}</option>`).join('');
        const typeOpts=[...new Set(this.data.toolings.map(t=>t.type))].map(o=>`<option>${o}</option>`).join('');
        const modelOpts=[...new Set(this.data.toolings.map(t=>t.model).filter(m=>m&&m!=='-'))].map(o=>`<option>${o}</option>`).join('');
        modal.innerHTML=`<div class="modal-content" style="max-width:640px;max-height:90vh"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-plus-circle" style="color:var(--accent-color);margin-right:0.5rem"></i>Daftar Tooling Baru</h3><button class="modal-close" onclick="app.closeModal('add-tooling-modal')">&times;</button></div><div class="modal-body" style="overflow-y:auto"><div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1rem">${fg('name','Nama Tooling/Dies *','Contoh: Front Door Panel Die')}<div class="form-group"><label class="form-label">Tipe <span style="color:var(--danger-color)">*</span></label><select id="at-type" class="form-control">${typeOpts}</select></div><div class="form-group"><label class="form-label">Part Number *</label><input id="at-pn" class="form-control" placeholder="Contoh: PN-FD-001"></div>${fg('partName','Nama Part','Contoh: Pintu Depan Kiri')}<div class="form-group"><label class="form-label">Model</label><select id="at-model" class="form-control">${modelOpts}</select></div>${fg('supplier','Supplier *','Contoh: PT Auto Parts')}${fg('supplierAddress','Alamat Supplier','Contoh: Jl. Industri Raya No. 123')}${fg('mapUrl','Google Maps Embed URL','Contoh: https://www.google.com/maps/embed?pb=...')}<div class="form-group"><label class="form-label">Kepemilikan</label><select id="at-owner" class="form-control"><option>Milik MII</option><option>Milik Supplier</option><option>Milik Pelanggan</option></select></div><div class="form-group"><label class="form-label">Status</label><select id="at-status" class="form-control">${statOpts}</select></div><div class="form-group"><label class="form-label">Kondisi</label><select id="at-cond" class="form-control">${condOpts}</select></div>${fg('maker','Tool/Dies Maker','')}${fg('weight','Berat','Contoh: 5,500 kg')}${fg('tonnage','Tonase Mesin','Contoh: 1,200 Ton')}${fg('dimensions','Dimensi (PxLxT)','Contoh: 1500 x 800 x 950 mm')}${fg('material','Material','Contoh: SKD11 / P20')}${fg('price','Harga','Contoh: Rp 450.000.000')}${fg('pic','PIC','Contoh: Ahmad S.')}${fg('picEmail','Email PIC','Contoh: ahmad@supplier.com')}${fg('picPhone','Telepon PIC','Contoh: +62 812-3456-7890')}${fgNum('maxShoot','Maximum Shoot','Contoh: 1000000')}${fgNum('qtyPerTooling','Qty Part per Tooling','Contoh: 1')}${fg('paNumber','No. PO/Tooling PA','Contoh: PA-2023-0098')}${!this.currentUser.role.includes('Supplier') ? `<div class="form-group"><label class="form-label">QTY Depresiasi (pcs)</label><input type="text" id="at-qtyDepreciation" class="form-control" placeholder="Contoh: 500000"></div>${fg('depreciationValue','Periode Depresiasi (tahun)','Contoh: 5')}` : ''}</div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('add-tooling-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitAddTooling()"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
        this.initNumberFormat('at-maxShoot');
        this.initNumberFormat('at-qtyPerTooling');
        if(!this.currentUser.role.includes('Supplier')) this.initNumberFormat('at-qtyDepreciation');
    }
    async submitAddTooling() {
        if (!this.currentUser.role.includes('Admin')) return;
        const v=id=>document.getElementById('at-'+id)?.value?.trim()||'';
        if(!v('name')||!v('pn')||!v('supplier')){alert('Harap isi field yang wajib (*).');return;}
        const mapCheck=this._validateMapUrl(v('mapUrl'));
        if(!mapCheck.valid){alert(mapCheck.msg);return;}
        const newId=`T-${new Date().getFullYear()}-${String(this.data.toolings.length+1).padStart(3,'0')}`;
        const supplierId = this._supplierIdByName(v('supplier'));
        const newTool={id:newId,name:v('name'),type:v('type')||'-',partNumber:v('pn'),partName:v('partName')||'-',model:v('model')||'-',supplier:v('supplier'),supplierId:supplierId,supplierAddress:v('supplierAddress')||'-',status:v('status')||'Aktif',condition:v('cond')||'Baik',owner:document.getElementById('at-owner')?.value||'Milik MII',lifetime:'0 / 1,000,000',maxShoot:this.parseFormattedNumber(v('maxShoot'))||0,lastMaintenance:'-',maker:v('maker')||'-',weight:v('weight')||'-',tonnage:v('tonnage')||'-',dimensions:v('dimensions')||'-',material:v('material')||'-',toolImage:'',toolImage2:'',partImage:'',depreciationType:'Tahun',depreciationValue:v('depreciationValue')||'5',qtyDepreciation:(this.parseFormattedNumber(v('qtyDepreciation'))?this.formatNumber(this.parseFormattedNumber(v('qtyDepreciation'))):'-'),paNumber:v('paNumber')||'-',paDocumentName:null,paDocumentPath:null,drawingDiesName:null,drawingDiesPath:null,price:v('price')||'-',notes:'-',pic:v('pic')||'-',picEmail:v('picEmail')||'-',picPhone:v('picPhone')||'-',qtyPerTooling:(this.parseFormattedNumber(v('qtyPerTooling'))?this.formatNumber(this.parseFormattedNumber(v('qtyPerTooling'))):'1'),mapUrl:v('mapUrl')||''};
        this.data.toolings.push(newTool);
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.insertTooling(newTool);}catch(e){console.error(e);alert('Gagal menyimpan tooling ke database.');}
        }
        this.closeModal('add-tooling-modal'); alert(`Tooling ${newId} berhasil ditambahkan!`); window.location.hash='#tooling'; this.renderLayout(); this.router();
    }

    // ===== EDIT TOOLING MODAL =====
    openEditToolingModal(toolId) {
        if (!this.currentUser.role.includes('Admin')) return;
        const t=this.data.toolings.find(x=>x.id===toolId); if(!t) return;
        const modal = document.createElement('div');
        modal.id='edit-tooling-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        const fg=(id,lbl,val)=>`<div class="form-group"><label class="form-label">${lbl}</label><input id="et-${id}" class="form-control" value="${val||''}"></div>`;
        const fgNum=(id,lbl,val)=>`<div class="form-group"><label class="form-label">${lbl}</label><input id="et-${id}" class="form-control" type="text" value="${val?app.formatNumber(val):''}"></div>`;
        const statOpts=['Aktif','Dalam Perbaikan','Tidak Aktif'].map(s=>`<option ${s===t.status?'selected':''}>${s}</option>`).join('');
        const condOpts=['Baik','Perlu Perbaikan','NG'].map(c=>`<option ${c===t.condition?'selected':''}>${c}</option>`).join('');
        const typeOpts=[...new Set(this.data.toolings.map(t=>t.type))].map(o=>`<option ${o===t.type?'selected':''}>${o}</option>`).join('');
        const modelOpts=[...new Set(this.data.toolings.map(t=>t.model).filter(m=>m&&m!=='-'))].map(o=>`<option ${o===t.model?'selected':''}>${o}</option>`).join('');
        modal.innerHTML=`<div class="modal-content" style="max-width:640px;max-height:90vh"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-edit" style="color:var(--accent-color);margin-right:0.5rem"></i>Ubah Tooling: ${toolId}</h3><button class="modal-close" onclick="app.closeModal('edit-tooling-modal')">&times;</button></div><div class="modal-body" style="overflow-y:auto"><div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1rem">${fg('name','Nama',t.name)}<div class="form-group"><label class="form-label">Tipe</label><select id="et-type" class="form-control">${typeOpts}</select></div><div class="form-group"><label class="form-label">Status</label><select id="et-status" class="form-control">${statOpts}</select></div><div class="form-group"><label class="form-label">Kondisi</label><select id="et-cond" class="form-control">${condOpts}</select></div><div class="form-group"><label class="form-label">Model</label><select id="et-model" class="form-control">${modelOpts}</select></div>${fg('supplier','Supplier',t.supplier)}${fg('supplierAddress','Alamat Supplier',t.supplierAddress)}${fg('mapUrl','Google Maps Embed URL',t.mapUrl)}${fg('maker','Maker',t.maker)}${fg('weight','Berat',t.weight)}${fg('tonnage','Tonase',t.tonnage)}${fg('material','Material',t.material)}${fg('price','Harga',t.price)}${fg('pic','PIC',t.pic)}${fg('picEmail','Email PIC',t.picEmail)}${fg('picPhone','Telepon PIC',t.picPhone)}${fgNum('maxShoot','Maximum Shoot',t.maxShoot)}${fgNum('qtyPerTooling','Qty Part per Tooling',parseInt((t.qtyPerTooling||'').replace(/,/g,'')))}${!this.currentUser.role.includes('Supplier') ? fgNum('qtyDepreciation','QTY Depresiasi (pcs)',parseInt((t.qtyDepreciation||'').replace(/,/g,'')))+fg('depreciationValue','Periode Depresiasi (tahun)',t.depreciationValue||'') : ''}</div></div><div class="modal-footer">${this.currentUser.role.includes('Admin') ? `<button type="button" class="btn btn-secondary" onclick="app.closeModal('edit-tooling-modal');app.openDrawingDiesModal('${toolId}')"><i class="fas fa-upload"></i> Upload Drawing</button>` : ''}<button class="btn btn-secondary" onclick="app.closeModal('edit-tooling-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitEditTooling('${toolId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
        this.initNumberFormat('et-maxShoot');
        this.initNumberFormat('et-qtyPerTooling');
        if(!this.currentUser.role.includes('Supplier')) this.initNumberFormat('et-qtyDepreciation');
    }
    async submitEditTooling(toolId) {
        if (!this.currentUser.role.includes('Admin')) return;
        const t=this.data.toolings.find(x=>x.id===toolId); if(!t) return;
        const v=id=>document.getElementById('et-'+id)?.value?.trim();
        const mapCheck=this._validateMapUrl(v('mapUrl'));
        if(!mapCheck.valid){alert(mapCheck.msg);return;}
        t.name=v('name')||t.name; t.type=v('type')||t.type; t.status=v('status')||t.status; t.condition=v('cond')||t.condition; t.model=v('model')||t.model; t.supplier=v('supplier')||t.supplier; t.supplierId=this._supplierIdByName(t.supplier); t.supplierAddress=v('supplierAddress')||t.supplierAddress; t.mapUrl=v('mapUrl')||t.mapUrl; t.maker=v('maker')||t.maker; t.weight=v('weight')||t.weight; t.tonnage=v('tonnage')||t.tonnage; t.material=v('material')||t.material; t.price=v('price')||t.price; t.pic=v('pic')||t.pic; t.picEmail=v('picEmail')||t.picEmail; t.picPhone=v('picPhone')||t.picPhone;         t.maxShoot=this.parseFormattedNumber(v('maxShoot'))||t.maxShoot; t.qtyPerTooling=this.parseFormattedNumber(v('qtyPerTooling'))?this.formatNumber(this.parseFormattedNumber(v('qtyPerTooling'))):t.qtyPerTooling; if(!this.currentUser.role.includes('Supplier')){t.qtyDepreciation=this.parseFormattedNumber(v('qtyDepreciation'))?this.formatNumber(this.parseFormattedNumber(v('qtyDepreciation'))):t.qtyDepreciation; t.depreciationValue=v('depreciationValue')||t.depreciationValue;}
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.updateTooling(toolId, t);}catch(e){console.error(e);alert('Gagal memperbarui tooling di database.');}
        }
        this.closeModal('edit-tooling-modal'); alert(`Data tooling ${toolId} berhasil diperbarui!`); document.getElementById('app-layout')?.remove(); this.router();
    }

    // ===== EVIDENCE VIEWER =====
    openEvidence(ticketId) {
        const l=this.data.maintenanceLogs.find(x=>x.id===ticketId);
        const urls=l?.evidencePath ? (Array.isArray(l.evidencePath)?[...l.evidencePath]:[l.evidencePath]) : [];
        if(urls.length===0 && l?.evidenceData){
            const data=Array.isArray(l.evidenceData)?l.evidenceData:[l.evidenceData];
            const names=Array.isArray(l.evidence)?l.evidence:[];
            if(data.length===1){
                const w=window.open('','_blank');
                w.document.write(`<html><head><title>Evidence - ${ticketId}</title><style>body{margin:0;height:100vh}iframe{width:100%;height:100%;border:0}</style></head><body><iframe src="${data[0]}"></iframe></body></html>`);
                w.document.close();
                return;
            }
            const w=window.open('','_blank');
            const tabs=data.map((d,i)=>{
                const n=names[i]||`File ${i+1}`;
                return `<button onclick="document.querySelectorAll('iframe').forEach(f=>f.style.display='none');document.getElementById('f${i}').style.display='block';document.querySelectorAll('.tab-btn').forEach(b=>b.style.background='');this.style.background='#2563eb';this.style.color='#fff'" class="tab-btn" style="padding:8px 16px;border:1px solid #ccc;cursor:pointer;border-radius:6px 6px 0 0;background:#f1f5f9;font-size:13px">${n}</button>`;
            }).join('');
            const iframes=data.map((d,i)=>`<iframe id="f${i}" src="${d}" style="width:100%;height:100%;border:0;${i>0?'display:none':''}"></iframe>`).join('');
            w.document.write(`<html><head><title>Evidence - ${ticketId}</title><style>body{margin:0;display:flex;flex-direction:column;height:100vh}nav{padding:8px;background:#f8fafc;border-bottom:1px solid #ccc;display:flex;gap:4px}.tab-btn:first-child{background:#2563eb;color:#fff}</style></head><body><nav>${tabs}</nav><div style="flex:1">${iframes}</div></body></html>`);
            w.document.close();
            return;
        }
        if(urls.length>0){
            const names=l.evidence?(Array.isArray(l.evidence)?[...l.evidence]:[l.evidence]):urls.map((_,i)=>`File ${i+1}`);
            if(urls.length===1){window.open(urls[0],'_blank');return;}
            const w=window.open('','_blank');
            const tabs=urls.map((d,i)=>{
                const n=names[i]||`File ${i+1}`;
                return `<button onclick="document.querySelectorAll('iframe').forEach(f=>f.style.display='none');document.getElementById('f${i}').style.display='block';document.querySelectorAll('.tab-btn').forEach(b=>b.style.background='');this.style.background='#2563eb';this.style.color='#fff'" class="tab-btn" style="padding:8px 16px;border:1px solid #ccc;cursor:pointer;border-radius:6px 6px 0 0;background:#f1f5f9;font-size:13px">${n}</button>`;
            }).join('');
            const iframes=urls.map((d,i)=>`<iframe id="f${i}" src="${d}" style="width:100%;height:100%;border:0;${i>0?'display:none':''}"></iframe>`).join('');
            w.document.write(`<html><head><title>Evidence - ${ticketId}</title><style>body{margin:0;display:flex;flex-direction:column;height:100vh}nav{padding:8px;background:#f8fafc;border-bottom:1px solid #ccc;display:flex;gap:4px}.tab-btn:first-child{background:#2563eb;color:#fff}</style></head><body><nav>${tabs}</nav><div style="flex:1">${iframes}</div></body></html>`);
            w.document.close();
            return;
        }
        window.open('evidence/dummy.pdf', '_blank');
    }

    // ===== PA DOCUMENT CONTEXT MENU =====
    showPaContextMenu(event, toolId) {
        event.preventDefault();
        event.stopPropagation();
        this.removePaContextMenu();
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const isSupplier = this.currentUser.role === 'Pengguna Supplier';
        const hasDoc = !!t.paDocumentName;
        const menu = document.createElement('div');
        menu.id = 'pa-context-menu';
        menu.style.cssText = 'position:fixed;z-index:10000;background:#fff;border:1px solid var(--border-color);border-radius:var(--border-radius);box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:180px;overflow:hidden;';
        let html = '';
        if (hasDoc) {
            html += `<div class="pa-ctx-item" onclick="event.stopPropagation();app.viewPaDocument('${toolId}')" style="padding:0.6rem 1rem;cursor:pointer;display:flex;align-items:center;gap:0.5rem;font-size:0.85rem"><i class="fas fa-eye" style="color:var(--accent-color)"></i> Lihat Dokumen</div>`;
        } else {
            html += `<div style="padding:0.6rem 1rem;color:var(--text-secondary);font-size:0.8rem;display:flex;align-items:center;gap:0.5rem"><i class="fas fa-info-circle"></i> Belum ada dokumen</div>`;
        }
        if (!isSupplier) {
            html += `<div class="pa-ctx-item" onclick="event.stopPropagation();app.openPaUploadModal('${toolId}')" style="padding:0.6rem 1rem;cursor:pointer;display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;border-top:1px solid var(--border-color)"><i class="fas fa-upload" style="color:var(--accent-color)"></i> ${hasDoc ? 'Ganti Dokumen' : 'Upload Dokumen'}</div>`;
            if (hasDoc) {
                html += `<div class="pa-ctx-item" onclick="event.stopPropagation();app.removePaDocument('${toolId}')" style="padding:0.6rem 1rem;cursor:pointer;display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;border-top:1px solid var(--border-color);color:var(--danger-color)"><i class="fas fa-trash"></i> Hapus Dokumen</div>`;
            }
        }
        menu.innerHTML = html;
        document.body.appendChild(menu);
        const x = Math.min(event.clientX || event.pageX, window.innerWidth - 200);
        const y = Math.min(event.clientY || event.pageY, window.innerHeight - 120);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        setTimeout(() => {
            document.addEventListener('click', this._paCtxCloseHandler = () => this.removePaContextMenu(), { once: true });
        }, 0);
    }

    removePaContextMenu() {
        const m = document.getElementById('pa-context-menu');
        if (m) m.remove();
    }

    viewPaDocument(toolId) {
        this.removePaContextMenu();
        const t = this.data.toolings.find(x => x.id === toolId);
        const urls=t?.paDocumentPath ? (Array.isArray(t.paDocumentPath)?[...t.paDocumentPath]:[t.paDocumentPath]) : [];
        if(urls.length===0 && !t?.paDocumentData){alert('Dokumen belum tersedia.');return;}
        if(urls.length===0 && t?.paDocumentData){
            const data=Array.isArray(t.paDocumentData)?t.paDocumentData:[t.paDocumentData];
            const names=Array.isArray(t.paDocumentName)?t.paDocumentName:[];
            if(data.length===1){
                const w = window.open('', '_blank');
                w.document.write(`<html><head><title>Dokumen PA - ${t.id}</title><style>body{margin:0;height:100vh}iframe{width:100%;height:100%;border:0}</style></head><body><iframe src="${data[0]}"></iframe></body></html>`);
                w.document.close();
                return;
            }
            const w=window.open('','_blank');
            const tabs=data.map((d,i)=>{
                const n=names[i]||`File ${i+1}`;
                return `<button onclick="document.querySelectorAll('iframe').forEach(f=>f.style.display='none');document.getElementById('f${i}').style.display='block';document.querySelectorAll('.tab-btn').forEach(b=>b.style.background='');this.style.background='#2563eb';this.style.color='#fff'" class="tab-btn" style="padding:8px 16px;border:1px solid #ccc;cursor:pointer;border-radius:6px 6px 0 0;background:#f1f5f9;font-size:13px">${n}</button>`;
            }).join('');
            const iframes=data.map((d,i)=>`<iframe id="f${i}" src="${d}" style="width:100%;height:100%;border:0;${i>0?'display:none':''}"></iframe>`).join('');
            w.document.write(`<html><head><title>Dokumen PA - ${t.id}</title><style>body{margin:0;display:flex;flex-direction:column;height:100vh}nav{padding:8px;background:#f8fafc;border-bottom:1px solid #ccc;display:flex;gap:4px}.tab-btn:first-child{background:#2563eb;color:#fff}</style></head><body><nav>${tabs}</nav><div style="flex:1">${iframes}</div></body></html>`);
            w.document.close();
            return;
        }
        const names=t.paDocumentName?(Array.isArray(t.paDocumentName)?[...t.paDocumentName]:[t.paDocumentName]):urls.map((_,i)=>`File ${i+1}`);
        if(urls.length===1){window.open(urls[0],'_blank');return;}
        const w=window.open('','_blank');
        const tabs=urls.map((d,i)=>{
            const n=names[i]||`File ${i+1}`;
            return `<button onclick="document.querySelectorAll('iframe').forEach(f=>f.style.display='none');document.getElementById('f${i}').style.display='block';document.querySelectorAll('.tab-btn').forEach(b=>b.style.background='');this.style.background='#2563eb';this.style.color='#fff'" class="tab-btn" style="padding:8px 16px;border:1px solid #ccc;cursor:pointer;border-radius:6px 6px 0 0;background:#f1f5f9;font-size:13px">${n}</button>`;
        }).join('');
        const iframes=urls.map((d,i)=>`<iframe id="f${i}" src="${d}" style="width:100%;height:100%;border:0;${i>0?'display:none':''}"></iframe>`).join('');
        w.document.write(`<html><head><title>Dokumen PA - ${t.id}</title><style>body{margin:0;display:flex;flex-direction:column;height:100vh}nav{padding:8px;background:#f8fafc;border-bottom:1px solid #ccc;display:flex;gap:4px}.tab-btn:first-child{background:#2563eb;color:#fff}</style></head><body><nav>${tabs}</nav><div style="flex:1">${iframes}</div></body></html>`);
        w.document.close();
    }

    openPaUploadModal(toolId) {
        this.removePaContextMenu();
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const modal = document.createElement('div');
        modal.id = 'pa-upload-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-file-upload" style="color:var(--accent-color);margin-right:0.5rem"></i>Upload Dokumen PA/PO</h3><button class="modal-close" onclick="app.closeModal('pa-upload-modal')">&times;</button></div><div class="modal-body">
            ${t.paDocumentName ? `<div style="margin-bottom:1rem;padding:0.75rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--border-radius);font-size:0.85rem"><i class="fas fa-file-pdf" style="color:#16a34a;margin-right:0.5rem"></i>Dokumen saat ini: <strong>${t.paDocumentName}</strong></div>` : ''}
            <div class="form-group"><label class="form-label">Pilih Dokumen <span style="color:var(--danger-color)">*</span></label>
            <input type="file" id="pa-file" class="form-control" accept=".pdf,.jpg,.jpeg,.png" multiple style="padding:0.375rem">
            <div id="pa-file-name" style="margin-top:0.35rem;font-size:0.85rem;color:var(--text-secondary);display:none"><i class="fas fa-paperclip"></i> <span></span></div>
            <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-secondary)">Format: PDF, JPG, PNG. Maksimal 10MB per file.</div></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('pa-upload-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitPaDocument('${toolId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        const fileInput = document.getElementById('pa-file');
        const nameSpan = document.getElementById('pa-file-name');
        if (fileInput && nameSpan) {
            fileInput.addEventListener('change', () => {
                if (fileInput.files.length > 0) {
                    nameSpan.style.display = 'block';
                    const names = Array.from(fileInput.files).map(f => f.name).join(', ');
                    nameSpan.querySelector('span').textContent = fileInput.files.length > 1 ? `${fileInput.files.length} file: ${names}` : names;
                } else {
                    nameSpan.style.display = 'none';
                }
            });
        }
    }

    async submitPaDocument(toolId) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const fileInput = document.getElementById('pa-file');
        const files = fileInput?.files;
        if (!files || files.length === 0) { alert('Harap pilih dokumen terlebih dahulu.'); return; }
        for (const f of files) {
            if (f.size > 10485760) { alert(`File "${f.name}" melebihi batas maksimal 10MB.`); return; }
        }
        const results = [];
        let loaded = 0;
        const done = async () => {
            if (loaded < files.length) return;
            t.paDocumentPath = results.length === 1 ? results[0].path : results.map(r => r.path);
            t.paDocumentName = results.length === 1 ? results[0].name : results.map(r => r.name);
            delete t.paDocumentData;
            if(window.DTMS && window.DTMS.enabled()){
                try{await window.DTMS.updateTooling(toolId, t);}catch(e){console.error(e);alert('Gagal menyimpan dokumen PA ke database.');}
            }
            this.closeModal('pa-upload-modal');
            this.closeModal('detail-modal');
            alert(`${results.length} dokumen berhasil diunggah!`);
            this.renderLayout(); this.router();
        };
        Array.from(files).forEach(f => {
            if(window.DTMS && window.DTMS.enabled()){
                const path=window.DTMS.makePath('documents', toolId, f.name);
                window.DTMS.uploadFile('documents', f, path).then(res => {
                    results.push({ name: f.name, path: res.publicUrl || res.path });
                    loaded++; done();
                }).catch(err => { console.error(err); loaded++; done(); });
            }else{
                const reader = new FileReader();
                reader.onload = e => { results.push({ name: f.name, path: e.target.result }); loaded++; done(); };
                reader.readAsDataURL(f);
            }
        });
    }

    async removePaDocument(toolId) {
        this.removePaContextMenu();
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const docName = Array.isArray(t.paDocumentName) ? t.paDocumentName.join(', ') : t.paDocumentName;
        if (!confirm(`Hapus dokumen "${docName}"?`)) return;
        t.paDocumentName = null;
        t.paDocumentPath = null;
        delete t.paDocumentData;
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.updateTooling(toolId, t);}catch(e){console.error(e);alert('Gagal menghapus dokumen PA di database.');}
        }
        this.closeModal('detail-modal');
        alert('Dokumen berhasil dihapus.');
        this.renderLayout(); this.router();
    }

    // ===== DRAWING DIES =====
    openDrawingDiesModal(toolId) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const modal = document.createElement('div');
        modal.id = 'drawing-dies-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-drafting-compass" style="color:var(--accent-color);margin-right:0.5rem"></i>Upload Drawing Dies</h3><button class="modal-close" onclick="app.closeModal('drawing-dies-modal')">&times;</button></div><div class="modal-body">
            ${t.drawingDiesName ? `<div style="margin-bottom:1rem;padding:0.75rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--border-radius);font-size:0.85rem"><i class="fas fa-file-pdf" style="color:#16a34a;margin-right:0.5rem"></i>Drawing saat ini: <strong>${Array.isArray(t.drawingDiesName) ? t.drawingDiesName.join(', ') : t.drawingDiesName}</strong></div>` : ''}
            <div class="form-group"><label class="form-label">Pilih File Drawing <span style="color:var(--danger-color)">*</span></label>
            <input type="file" id="dd-file" class="form-control" accept=".pdf,.jpg,.jpeg,.png" multiple style="padding:0.375rem">
            <div id="dd-file-name" style="margin-top:0.35rem;font-size:0.85rem;color:var(--text-secondary);display:none"><i class="fas fa-paperclip"></i> <span></span></div>
            <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-secondary)">Format: PDF, JPG, PNG. Maksimal 10MB per file.</div></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('drawing-dies-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitDrawingDies('${toolId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        const fileInput = document.getElementById('dd-file');
        const nameSpan = document.getElementById('dd-file-name');
        if (fileInput && nameSpan) {
            fileInput.addEventListener('change', () => {
                if (fileInput.files.length > 0) {
                    nameSpan.style.display = 'block';
                    const names = Array.from(fileInput.files).map(f => f.name).join(', ');
                    nameSpan.querySelector('span').textContent = fileInput.files.length > 1 ? `${fileInput.files.length} file: ${names}` : names;
                } else {
                    nameSpan.style.display = 'none';
                }
            });
        }
    }

    async submitDrawingDies(toolId) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const fileInput = document.getElementById('dd-file');
        const files = fileInput?.files;
        if (!files || files.length === 0) { alert('Harap pilih file drawing terlebih dahulu.'); return; }
        for (const f of files) {
            if (f.size > 10485760) { alert(`File "${f.name}" melebihi batas maksimal 10MB.`); return; }
        }
        const results = [];
        let loaded = 0;
        const done = async () => {
            if (loaded < files.length) return;
            t.drawingDiesPath = results.length === 1 ? results[0].path : results.map(r => r.path);
            t.drawingDiesName = results.length === 1 ? results[0].name : results.map(r => r.name);
            delete t.drawingDiesData;
            if(window.DTMS && window.DTMS.enabled()){
                try{await window.DTMS.updateTooling(toolId, t);}catch(e){console.error(e);alert('Gagal menyimpan drawing ke database.');}
            }
            this.closeModal('drawing-dies-modal');
            alert(`${results.length} drawing berhasil diunggah!`);
            document.getElementById('app-layout')?.remove(); this.router();
        };
        Array.from(files).forEach(f => {
            if(window.DTMS && window.DTMS.enabled()){
                const path=window.DTMS.makePath('documents', toolId, f.name);
                window.DTMS.uploadFile('documents', f, path).then(res => {
                    results.push({ name: f.name, path: res.publicUrl || res.path });
                    loaded++; done();
                }).catch(err => { console.error(err); loaded++; done(); });
            }else{
                const reader = new FileReader();
                reader.onload = e => { results.push({ name: f.name, path: e.target.result }); loaded++; done(); };
                reader.readAsDataURL(f);
            }
        });
    }

    viewDrawingDies(toolId) {
        const t = this.data.toolings.find(x => x.id === toolId);
        const urls=t?.drawingDiesPath ? (Array.isArray(t.drawingDiesPath)?[...t.drawingDiesPath]:[t.drawingDiesPath]) : [];
        if(urls.length===0 && !t?.drawingDiesData){alert('Drawing belum tersedia.');return;}
        if(urls.length===0 && t?.drawingDiesData){
            const data = Array.isArray(t.drawingDiesData) ? t.drawingDiesData : [t.drawingDiesData];
            const names = Array.isArray(t.drawingDiesName) ? t.drawingDiesName : [];
            if (data.length === 1) {
                const w = window.open('', '_blank');
                w.document.write(`<html><head><title>Drawing Dies - ${t.id}</title><style>body{margin:0;height:100vh}iframe{width:100%;height:100%;border:0}</style></head><body><iframe src="${data[0]}"></iframe></body></html>`);
                w.document.close();
                return;
            }
            const w = window.open('', '_blank');
            const tabs = data.map((d, i) => {
                const n = names[i] || `File ${i + 1}`;
                return `<button onclick="document.querySelectorAll('iframe').forEach(f=>f.style.display='none');document.getElementById('f${i}').style.display='block';document.querySelectorAll('.tab-btn').forEach(b=>b.style.background='');this.style.background='#2563eb';this.style.color='#fff'" class="tab-btn" style="padding:8px 16px;border:1px solid #ccc;cursor:pointer;border-radius:6px 6px 0 0;background:#f1f5f9;font-size:13px">${n}</button>`;
            }).join('');
            const iframes = data.map((d, i) => `<iframe id="f${i}" src="${d}" style="width:100%;height:100%;border:0;${i > 0 ? 'display:none' : ''}"></iframe>`).join('');
            w.document.write(`<html><head><title>Drawing Dies - ${t.id}</title><style>body{margin:0;display:flex;flex-direction:column;height:100vh}nav{padding:8px;background:#f8fafc;border-bottom:1px solid #ccc;display:flex;gap:4px}.tab-btn:first-child{background:#2563eb;color:#fff}</style></head><body><nav>${tabs}</nav><div style="flex:1">${iframes}</div></body></html>`);
            w.document.close();
            return;
        }
        const names=t.drawingDiesName?(Array.isArray(t.drawingDiesName)?[...t.drawingDiesName]:[t.drawingDiesName]):urls.map((_,i)=>`File ${i+1}`);
        if(urls.length===1){window.open(urls[0],'_blank');return;}
        const w = window.open('', '_blank');
        const tabs = urls.map((d, i) => {
            const n = names[i] || `File ${i + 1}`;
            return `<button onclick="document.querySelectorAll('iframe').forEach(f=>f.style.display='none');document.getElementById('f${i}').style.display='block';document.querySelectorAll('.tab-btn').forEach(b=>b.style.background='');this.style.background='#2563eb';this.style.color='#fff'" class="tab-btn" style="padding:8px 16px;border:1px solid #ccc;cursor:pointer;border-radius:6px 6px 0 0;background:#f1f5f9;font-size:13px">${n}</button>`;
        }).join('');
        const iframes = urls.map((d, i) => `<iframe id="f${i}" src="${d}" style="width:100%;height:100%;border:0;${i > 0 ? 'display:none' : ''}"></iframe>`).join('');
        w.document.write(`<html><head><title>Drawing Dies - ${t.id}</title><style>body{margin:0;display:flex;flex-direction:column;height:100vh}nav{padding:8px;background:#f8fafc;border-bottom:1px solid #ccc;display:flex;gap:4px}.tab-btn:first-child{background:#2563eb;color:#fff}</style></head><body><nav>${tabs}</nav><div style="flex:1">${iframes}</div></body></html>`);
        w.document.close();
    }

    async removeDrawingDies(toolId) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const docName = Array.isArray(t.drawingDiesName) ? t.drawingDiesName.join(', ') : t.drawingDiesName;
        if (!confirm(`Hapus drawing "${docName}"?`)) return;
        t.drawingDiesName = null;
        t.drawingDiesPath = null;
        delete t.drawingDiesData;
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.updateTooling(toolId, t);}catch(e){console.error(e);alert('Gagal menghapus drawing di database.');}
        }
        alert('Drawing berhasil dihapus.');
        document.getElementById('app-layout')?.remove(); this.router();
    }

    // ===== PHOTO UPLOAD (Part, Tooling 1, Tooling 2) =====
    openPhotoUploadModal(toolId, fieldType) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const labels = { partImage: 'Foto Part', toolImage: 'Foto Tooling/Dies 1', toolImage2: 'Foto Tooling/Dies 2' };
        const lbl = labels[fieldType] || 'Foto';
        const modal = document.createElement('div');
        modal.id = 'photo-upload-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-camera" style="color:var(--accent-color);margin-right:0.5rem"></i>Upload ${lbl}</h3><button class="modal-close" onclick="app.closeModal('photo-upload-modal')">&times;</button></div><div class="modal-body">
            ${t[fieldType] ? `<div style="margin-bottom:1rem"><span class="info-label">Foto Saat Ini</span><img src="${t[fieldType]}" alt="${lbl}" style="width:100%;height:auto;border-radius:8px;margin-top:0.5rem;border:1px solid var(--border-color)"></div>` : ''}
            <div class="form-group"><label class="form-label">Pilih Foto <span style="color:var(--danger-color)">*</span></label>
            <input type="file" id="pu-file" class="form-control" accept=".jpg,.jpeg,.png" style="padding:0.375rem">
            <div id="pu-file-name" style="margin-top:0.35rem;font-size:0.85rem;color:var(--text-secondary);display:none"><i class="fas fa-paperclip"></i> <span></span></div>
            <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-secondary)">Format: JPG, PNG. Maksimal 5MB. Foto lama akan diganti otomatis.</div></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('photo-upload-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitPhotoUpload('${toolId}','${fieldType}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        const fileInput = document.getElementById('pu-file');
        const nameSpan = document.getElementById('pu-file-name');
        if (fileInput && nameSpan) {
            fileInput.addEventListener('change', () => {
                if (fileInput.files.length > 0) {
                    nameSpan.style.display = 'block';
                    nameSpan.querySelector('span').textContent = fileInput.files[0].name;
                } else {
                    nameSpan.style.display = 'none';
                }
            });
        }
    }

    async submitPhotoUpload(toolId, fieldType) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const fileInput = document.getElementById('pu-file');
        const file = fileInput?.files?.[0];
        if (!file) { alert('Harap pilih foto terlebih dahulu.'); return; }
        if (file.size > 5242880) { alert(`File "${file.name}" melebihi batas maksimal 5MB.`); return; }
        if (window.DTMS && window.DTMS.enabled()) {
            const path = window.DTMS.makePath('images', toolId + '/' + fieldType, file.name);
            const res = await window.DTMS.uploadFile('images', file, path);
            if (res.publicUrl) {
                t[fieldType] = res.publicUrl;
            } else {
                alert('Gagal mengunggah foto ke storage.');
                return;
            }
            try { await window.DTMS.updateTooling(toolId, { [fieldType]: res.publicUrl }); } catch (e) { console.error(e); alert('Gagal menyimpan URL foto ke database.'); }
            this.closeModal('photo-upload-modal');
            alert('Foto berhasil diunggah!');
            document.getElementById('app-layout')?.remove(); this.router();
            return;
        }
        const reader = new FileReader();
        reader.onload = e => {
            t[fieldType] = e.target.result;
            this.closeModal('photo-upload-modal');
            alert('Foto berhasil diunggah!');
            document.getElementById('app-layout')?.remove(); this.router();
        };
        reader.readAsDataURL(file);
    }

    async removePhoto(toolId, fieldType) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const labels = { partImage: 'Foto Part', toolImage: 'Foto Tooling/Dies 1', toolImage2: 'Foto Tooling/Dies 2' };
        if (!confirm(`Hapus ${labels[fieldType] || 'foto'}?`)) return;
        t[fieldType] = '';
        if (window.DTMS && window.DTMS.enabled()) {
            try { await window.DTMS.updateTooling(toolId, { [fieldType]: '' }); } catch (e) { console.error(e); alert('Gagal menghapus foto di database.'); }
        }
        alert('Foto berhasil dihapus.');
        document.getElementById('app-layout')?.remove(); this.router();
    }

    parseIndonesianDate(str) {
        const map = {'Jan':'01','Feb':'02','Mar':'03','Apr':'04','May':'05','Jun':'06','Jul':'07','Aug':'08','Sep':'09','Oct':'10','Nov':'11','Dec':'12','Mei':'05','Agu':'08','Okt':'10','Des':'12'};
        const p = str.split(' ');
        if (p.length !== 3) return '';
        return `${p[2]}-${map[p[1]]||'01'}-${p[0].padStart(2,'0')}`;
    }

    // ===== REPAIR CRUD: ADD =====
    openAddRepairModal(toolId, toolName) {
        const today = new Date().toISOString().split('T')[0];
        const modal = document.createElement('div');
        modal.id='add-repair-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        modal.innerHTML=`<div class="modal-content" style="max-width:500px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-plus-circle" style="color:var(--accent-color);margin-right:0.5rem"></i>Tambah Riwayat Pemeliharaan</h3><button class="modal-close" onclick="app.closeModal('add-repair-modal')">&times;</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Tooling</label><input class="form-control" value="${toolId} – ${toolName}" readonly style="background:#f1f5f9"></div><div class="form-group"><label class="form-label">Tgl Mulai <span style="color:var(--danger-color)">*</span></label><input type="date" id="rp-dateStart" class="form-control" value="${today}"></div><div class="form-group"><label class="form-label">Tgl Selesai</label><input type="date" id="rp-dateEnd" class="form-control"></div><div class="form-group"><label class="form-label">Tipe Perbaikan <span style="color:var(--danger-color)">*</span></label><select id="rp-type" class="form-control"><option>Corrective Repair</option><option>Preventive</option></select></div><div class="form-group"><label class="form-label">Deskripsi <span style="color:var(--danger-color)">*</span></label><textarea id="rp-desc" class="form-control" rows="3" placeholder="Jelaskan perbaikan yang dilakukan..."></textarea></div><div class="form-group"><label class="form-label">Status <span style="color:var(--danger-color)">*</span></label><select id="rp-status" class="form-control"><option>Sedang Berlangsung</option><option>Selesai</option></select></div><div class="form-group"><label class="form-label">Upload File Evidence</label><input type="file" id="rp-evidence" class="form-control" accept=".pdf,.jpg,.jpeg,.png" multiple style="padding:0.375rem"><div id="rp-evidence-name" style="margin-top:0.35rem;font-size:0.85rem;color:var(--text-secondary);display:none"><i class="fas fa-paperclip"></i> <span></span></div><div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-secondary)">Format: PDF, JPG, PNG. Maksimal 10MB per file.</div></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('add-repair-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitAddRepair('${toolId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
        document.getElementById('rp-evidence')?.addEventListener('change', function(){
            const fs=this.files;
            const el=document.getElementById('rp-evidence-name');
            if(fs&&fs.length>0){
                const names=Array.from(fs).map(f=>f.name).join(', ');
                el.querySelector('span').textContent=fs.length>1?`${fs.length} file: ${names}`:names;
                el.style.display='block';
            }
            else el.style.display='none';
        });
    }
    async submitAddRepair(toolId) {
        const t=this.data.toolings.find(x=>x.id===toolId); if(!t) return;
        const dateStart=document.getElementById('rp-dateStart')?.value;
        const dateEnd=document.getElementById('rp-dateEnd')?.value;
        const type=document.getElementById('rp-type')?.value;
        const desc=document.getElementById('rp-desc')?.value?.trim();
        const status=document.getElementById('rp-status')?.value;
        const fileInput=document.getElementById('rp-evidence');
        const files=fileInput?.files;
        if(!dateStart||!desc){alert('Harap isi tanggal mulai dan deskripsi perbaikan.');return;}
        const year=new Date().getFullYear();
        const maxId=this.data.maintenanceLogs.reduce((max,l)=>{
            const m=l.id.match(/MR-(\d+)-(\d+)/);
            return m&&m[1]===String(year)?Math.max(max,parseInt(m[2])):max;
        },0);
        const newId=`MR-${year}-${String(maxId+1).padStart(3,'0')}`;
        const fmtDateStart=new Date(dateStart).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
        const fmtDateEnd=dateEnd?new Date(dateEnd).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}):null;
        const afterRead=async(nameArr, pathArr)=>{
            const newLog={
                id:newId,toolId,toolName:t.name,dateStart:fmtDateStart,dateEnd:fmtDateEnd,type,description:desc,status,
                evidence:nameArr? (nameArr.length===1?nameArr[0]:nameArr.join(', ')) : '',
                evidencePath:pathArr? (pathArr.length===1?pathArr[0]:pathArr.join(', ')) : '',
                requestedBy:this.currentUser.name
            };
            this.data.maintenanceLogs.unshift(newLog);
            if(window.DTMS && window.DTMS.enabled()){
                try{await window.DTMS.insertMaintenanceLog(newLog);}catch(e){console.error(e);alert('Gagal menyimpan perbaikan ke database.');}
            }
            this.closeModal('add-repair-modal');
            alert(`Riwayat perbaikan ${newId} berhasil ditambahkan!`);
            document.getElementById('app-layout')?.remove(); this.router();
        };
        if(files&&files.length>0){
            const fileArr=Array.from(files);
            for(const f of fileArr){if(f.size>10485760){alert(`File "${f.name}" melebihi batas maksimal 10MB.`);return;}}
            const results=[];let loaded=0;
            const done=async()=>{
                if(loaded<fileArr.length)return;
                const nameArr=results.map(r=>r.name);
                const pathArr=results.map(r=>r.path);
                await afterRead(nameArr,pathArr);
            };
            fileArr.forEach(f=>{
                if(window.DTMS && window.DTMS.enabled()){
                    const path=window.DTMS.makePath('maintenanceLogs',newId,f.name);
                    window.DTMS.uploadFile('evidence',f,path).then(res=>{
                        results.push({name:f.name,path:res.publicUrl||res.path});
                        loaded++;done();
                    }).catch(err=>{console.error(err);loaded++;done();});
                }else{
                    const reader=new FileReader();
                    reader.onload=e=>{results.push({name:f.name,path:e.target.result});loaded++;done();};
                    reader.readAsDataURL(f);
                }
            });
        }else{
            await afterRead(null,null);
        }
    }

    // ===== REPAIR CRUD: EDIT =====
    openEditRepairModal(logId) {
        const l=this.data.maintenanceLogs.find(x=>x.id===logId); if(!l) return;
        const modal = document.createElement('div');
        modal.id='edit-repair-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        const dateStartStr=l.dateStart;
        const dateEndStr=l.dateEnd||'';
        const isoDateStart=dateStartStr ? this.parseIndonesianDate(dateStartStr) : '';
        const isoDateEnd=dateEndStr ? this.parseIndonesianDate(dateEndStr) : '';
        const typeOpts=['Corrective Repair','Preventive'].map(o=>`<option ${o===l.type?'selected':''}>${o}</option>`).join('');
        const statusOpts=['Sedang Berlangsung','Selesai'].map(o=>`<option ${o===l.status?'selected':''}>${o}</option>`).join('');
        modal.innerHTML=`<div class="modal-content" style="max-width:500px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-edit" style="color:var(--accent-color);margin-right:0.5rem"></i>Ubah Riwayat Pemeliharaan: ${logId}</h3><button class="modal-close" onclick="app.closeModal('edit-repair-modal')">&times;</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Tooling</label><input class="form-control" value="${l.toolId} � ${l.toolName}" readonly style="background:#f1f5f9"></div><div class="form-group"><label class="form-label">Tgl Mulai <span style="color:var(--danger-color)">*</span></label><input type="date" id="erp-dateStart" class="form-control" value="${isoDateStart}"></div><div class="form-group"><label class="form-label">Tgl Selesai</label><input type="date" id="erp-dateEnd" class="form-control" value="${isoDateEnd}"></div><div class="form-group"><label class="form-label">Tipe Perbaikan <span style="color:var(--danger-color)">*</span></label><select id="erp-type" class="form-control">${typeOpts}</select></div><div class="form-group"><label class="form-label">Deskripsi <span style="color:var(--danger-color)">*</span></label><textarea id="erp-desc" class="form-control" rows="3">${l.description||''}</textarea></div><div class="form-group"><label class="form-label">Status <span style="color:var(--danger-color)">*</span></label><select id="erp-status" class="form-control">${statusOpts}</select></div><div class="form-group"><label class="form-label">Upload File Evidence</label>${l.evidence?`<div style="margin-bottom:0.5rem;font-size:0.85rem;color:var(--text-secondary)"><i class="fas fa-paperclip"></i> File saat ini: ${Array.isArray(l.evidence)?l.evidence.join(', '):l.evidence}</div>`:''}<input type="file" id="erp-evidence" class="form-control" accept=".pdf,.jpg,.jpeg,.png" multiple style="padding:0.375rem"><div id="erp-evidence-name" style="margin-top:0.35rem;font-size:0.85rem;color:var(--text-secondary);display:none"><i class="fas fa-paperclip"></i> <span></span></div><div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-secondary)">Format: PDF, JPG, PNG. Maksimal 10MB per file.</div></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('edit-repair-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitEditRepair('${logId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
        document.getElementById('erp-evidence')?.addEventListener('change', function(){
            const fs=this.files;
            const el=document.getElementById('erp-evidence-name');
            if(fs&&fs.length>0){
                const names=Array.from(fs).map(f=>f.name).join(', ');
                el.querySelector('span').textContent=fs.length>1?`${fs.length} file: ${names}`:names;
                el.style.display='block';
            }
            else el.style.display='none';
        });
    }
    async submitEditRepair(logId) {
        const l=this.data.maintenanceLogs.find(x=>x.id===logId); if(!l) return;
        const dateStart=document.getElementById('erp-dateStart')?.value;
        const dateEnd=document.getElementById('erp-dateEnd')?.value;
        const type=document.getElementById('erp-type')?.value;
        const desc=document.getElementById('erp-desc')?.value?.trim();
        const status=document.getElementById('erp-status')?.value;
        const fileInput=document.getElementById('erp-evidence');
        const files=fileInput?.files;
        if(!dateStart||!desc){alert('Harap isi tanggal mulai dan deskripsi perbaikan.');return;}
        const afterRead=async(nameArr, pathArr)=>{
            const fmtDateStart=new Date(dateStart).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
            const fmtDateEnd=dateEnd?new Date(dateEnd).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}):null;
            l.dateStart=fmtDateStart; l.dateEnd=fmtDateEnd; l.type=type; l.description=desc; l.status=status;
            if(nameArr){l.evidence=nameArr.length===1?nameArr[0]:nameArr.join(', '); l.evidencePath=pathArr.length===1?pathArr[0]:pathArr.join(', ');}
            delete l.evidenceData;
            if(window.DTMS && window.DTMS.enabled()){
                try{await window.DTMS.updateMaintenanceLog(logId, l);}catch(e){console.error(e);alert('Gagal memperbarui perbaikan di database.');}
            }
            this.closeModal('edit-repair-modal');
            alert(`Riwayat perbaikan ${logId} berhasil diperbarui!`);
            document.getElementById('app-layout')?.remove(); this.router();
        };
        if(files&&files.length>0){
            const fileArr=Array.from(files);
            for(const f of fileArr){if(f.size>10485760){alert(`File "${f.name}" melebihi batas maksimal 10MB.`);return;}}
            const results=[];let loaded=0;
            const done=async()=>{
                if(loaded<fileArr.length)return;
                const nameArr=results.map(r=>r.name);
                const pathArr=results.map(r=>r.path);
                await afterRead(nameArr,pathArr);
            };
            fileArr.forEach(f=>{
                if(window.DTMS && window.DTMS.enabled()){
                    const path=window.DTMS.makePath('maintenanceLogs',logId,f.name);
                    window.DTMS.uploadFile('evidence',f,path).then(res=>{
                        results.push({name:f.name,path:res.publicUrl||res.path});
                        loaded++;done();
                    }).catch(err=>{console.error(err);loaded++;done();});
                }else{
                    const reader=new FileReader();
                    reader.onload=e=>{results.push({name:f.name,path:e.target.result});loaded++;done();};
                    reader.readAsDataURL(f);
                }
            });
        }else{
            await afterRead(null,null);
        }
    }

    // ===== REPAIR CRUD: DELETE =====
    async submitDeleteRepair(logId, toolId) {
        const idx=this.data.maintenanceLogs.findIndex(x=>x.id===logId);
        if(idx===-1) return;
        if(!confirm(`Yakin ingin menghapus riwayat perbaikan ${logId}?`)) return;
        this.data.maintenanceLogs.splice(idx,1);
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.deleteMaintenanceLog(logId);}catch(e){console.error(e);alert('Gagal menghapus perbaikan di database.');}
        }
        alert(`Riwayat perbaikan ${logId} berhasil dihapus.`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    // ===== USER CRUD =====
    openAddUserModal() {
        const modal=document.createElement('div');
        modal.id='add-user-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        const genPw = (window.DTMS && window.DTMS.generatePassword) ? window.DTMS.generatePassword() : Math.random().toString(36).slice(2,10);
        modal.innerHTML=`<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-plus-circle" style="color:var(--accent-color);margin-right:0.5rem"></i>Tambah Pengguna</h3><button class="modal-close" onclick="app.closeModal('add-user-modal')">&times;</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Username <span style="color:var(--danger-color)">*</span></label><input type="text" id="au-username" class="form-control" placeholder="Contoh: supplier2"></div><div class="form-group"><label class="form-label">Nama Lengkap <span style="color:var(--danger-color)">*</span></label><input type="text" id="au-name" class="form-control" placeholder="Contoh: Budi Santoso"></div><div class="form-group"><label class="form-label">Password <span style="color:var(--danger-color)">*</span></label><input type="text" id="au-password" class="form-control" value="${genPw}" placeholder="Password untuk login"></div><div class="form-group"><label class="form-label">Perusahaan <span style="color:var(--danger-color)">*</span></label><input type="text" id="au-company" class="form-control" placeholder="Contoh: PT Maju Jaya"></div><div class="form-group"><label class="form-label">Role <span style="color:var(--danger-color)">*</span></label><select id="au-role" class="form-control"><option>Admin Sistem</option><option>Purchasing MII</option><option selected>Pengguna Supplier</option></select></div><div class="form-group"><label class="form-label">Supplier ID (opsional)</label><input type="text" id="au-supplierid" class="form-control" placeholder="Contoh: SUP002"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('add-user-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitAddUser()"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
    }

    async submitAddUser() {
        const username=document.getElementById('au-username')?.value?.trim();
        const name=document.getElementById('au-name')?.value?.trim();
        const role=document.getElementById('au-role')?.value;
        const supplierId=document.getElementById('au-supplierid')?.value?.trim()||'';
        const company=document.getElementById('au-company')?.value?.trim()||'';
        const password=document.getElementById('au-password')?.value?.trim();
        if(!username||!name||!company){alert('Username, Nama Lengkap, dan Perusahaan wajib diisi.');return;}
        if(this.data.users.some(x=>x.username===username)){alert(`Username "${username}" sudah digunakan.`);return;}
        const maxId=this.data.users.reduce((m,x)=>Math.max(m,x.id),0);
        const newUser={id:maxId+1,username,email:`${username}@dtms.mail`,name,role,supplierId:supplierId||undefined,company:company||undefined};
        this.data.users.push(newUser);
        const finalPw = password || (window.DTMS && window.DTMS.generatePassword ? window.DTMS.generatePassword() : 'password123');
        if(window.DTMS && window.DTMS.enabled()){
            try{
                await window.DTMS.insertUser(newUser);
                const meta={username,name,role,company,supplierId:supplierId||null};
                await window.DTMS.signUp(newUser.email, finalPw, meta);
            }catch(e){console.error(e);alert('Gagal menyimpan pengguna ke database/auth.');}
        }
        this.closeModal('add-user-modal');
        alert(`Pengguna ${username} berhasil ditambahkan. Password: ${finalPw}`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    openEditUserModal(userId) {
        const u=this.data.users.find(x=>x.id===userId);
        if(!u)return;
        const modal=document.createElement('div');
        modal.id='edit-user-modal'; modal.className='modal-overlay'; modal.style.cssText='display:flex;opacity:1;visibility:visible;';
        const roleOpts=['Admin Sistem','Purchasing MII','Pengguna Supplier'].map(r=>`<option${r===u.role?' selected':''}>${r}</option>`).join('');
        modal.innerHTML=`<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-edit" style="color:var(--accent-color);margin-right:0.5rem"></i>Ubah Pengguna: ${u.username}</h3><button class="modal-close" onclick="app.closeModal('edit-user-modal')">&times;</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Username</label><input type="text" class="form-control" value="${u.username}" readonly style="background:#f1f5f9"></div><div class="form-group"><label class="form-label">Nama Lengkap <span style="color:var(--danger-color)">*</span></label><input type="text" id="eu-name" class="form-control" value="${u.name}"></div><div class="form-group"><label class="form-label">Password Baru (opsional)</label><input type="text" id="eu-password" class="form-control" placeholder="Kosongkan jika tidak ingin mengubah"></div><div class="form-group"><label class="form-label">Perusahaan</label><input type="text" id="eu-company" class="form-control" value="${u.company||''}" placeholder="Contoh: PT Maju Jaya"></div><div class="form-group"><label class="form-label">Role <span style="color:var(--danger-color)">*</span></label><select id="eu-role" class="form-control">${roleOpts}</select></div><div class="form-group"><label class="form-label">Supplier ID (opsional)</label><input type="text" id="eu-supplierid" class="form-control" value="${u.supplierId||''}" placeholder="Contoh: SUP002"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('edit-user-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitEditUser(${userId})"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow='hidden';
    }

    async submitEditUser(userId) {
        const u=this.data.users.find(x=>x.id===userId);
        if(!u)return;
        const name=document.getElementById('eu-name')?.value?.trim();
        const role=document.getElementById('eu-role')?.value;
        const supplierId=document.getElementById('eu-supplierid')?.value?.trim()||'';
        const company=document.getElementById('eu-company')?.value?.trim()||'';
        const newPassword=document.getElementById('eu-password')?.value?.trim();
        if(!name){alert('Nama Lengkap wajib diisi.');return;}
        u.name=name; u.role=role; u.supplierId=supplierId||undefined; u.company=company||undefined;
        if(window.DTMS && window.DTMS.enabled()){
            try{
                await window.DTMS.updateUser(userId, u);
                if(newPassword){
                    const result = await window.DTMS.updateAuthPassword(u.email, newPassword);
                    if(result.error){
                        console.error('Update password error:', result.error);
                        alert('Data pengguna diperbarui, tetapi gagal mengubah password: ' + result.error.message);
                    }
                }
            }catch(e){console.error(e);alert('Gagal memperbarui pengguna di database.');}
        }
        this.closeModal('edit-user-modal');
        alert(`Data pengguna ${u.username} berhasil diperbarui.${newPassword ? ' Password baru: ' + newPassword : ''}`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    async submitDeleteUser(userId) {
        const idx=this.data.users.findIndex(x=>x.id===userId);
        if(idx===-1)return;
        const u=this.data.users[idx];
        if(u.username==='admin'){alert('User admin tidak dapat dihapus.');return;}
        if(!confirm(`Yakin ingin menghapus pengguna "${u.username}" (${u.name})?`))return;
        if(window.DTMS && window.DTMS.enabled()){
            const authResult = await window.DTMS.deleteAuthUser(u.email);
            if(authResult.error){
                alert('Gagal menghapus akun: ' + authResult.error.message + '\nPengguna tidak dihapus. Pastikan Edge Function admin-user sudah di-deploy.');
                return;
            }
            try{
                await window.DTMS.deleteUser(userId);
                this.data.users.splice(idx,1);
            }catch(e){
                console.error(e);
                alert('Gagal menghapus pengguna dari database: ' + (e?.message || e));
                return;
            }
        } else {
            this.data.users.splice(idx,1);
        }
        alert(`Pengguna ${u.username} berhasil dihapus.`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    // ===== AGGREGATE PERIODS =====
    aggregatePeriods(logs, period) {
        if (period === 'monthly') return logs;
        const groups = {};
        const order = [];
        logs.forEach(log => {
            const [y, m] = log.month.split('-');
            const mi = parseInt(m);
            const yr = parseInt(y);
            let key, label, shortLabel, sortKey;
            if (period === 'quarterly') {
                if (mi >= 4 && mi <= 6) { key = `${yr}-Q1`; label = `FY${yr} Q1 (Apr-Jun ${yr})`; shortLabel = `${yr} Q1`; sortKey = yr * 10 + 1; }
                else if (mi >= 7 && mi <= 9) { key = `${yr}-Q2`; label = `FY${yr} Q2 (Jul-Sep ${yr})`; shortLabel = `${yr} Q2`; sortKey = yr * 10 + 2; }
                else if (mi >= 10 && mi <= 12) { key = `${yr}-Q3`; label = `FY${yr} Q3 (Okt-Des ${yr})`; shortLabel = `${yr} Q3`; sortKey = yr * 10 + 3; }
                else { key = `${yr}-Q4`; label = `FY${yr - 1} Q4 (Jan-Mar ${yr})`; shortLabel = `${yr - 1} Q4`; sortKey = (yr - 1) * 10 + 4; }
            } else if (period === 'semester') {
                if (mi >= 4 && mi <= 9) { key = `${yr}-S1`; label = `FY${yr} S1 (Apr-Sep ${yr})`; shortLabel = `${yr} S1`; sortKey = yr * 10 + 1; }
                else { key = `${yr}-S2`; label = `FY${yr - 1} S2 (Okt-Mar ${yr})`; shortLabel = `${yr - 1} S2`; sortKey = (yr - 1) * 10 + 2; }
            } else if (period === 'fiscal') {
                if (mi >= 4) { key = `FY${yr}`; label = `FY${yr}`; shortLabel = `FY${yr}`; sortKey = yr; }
                else { key = `FY${yr - 1}`; label = `FY${yr - 1}`; shortLabel = `FY${yr - 1}`; sortKey = yr - 1; }
            }
            if (!groups[key]) { groups[key] = { label, shortLabel, sortKey, items: [] }; order.push(key); }
            groups[key].items.push(log);
        });
        return order.sort((a, b) => groups[a].sortKey - groups[b].sortKey).map(key => {
            const g = groups[key];
            const rec = { id: g.items[0].id, month: g.label, shortLabel: g.shortLabel, inputDate: '' };
            if (g.items[0].shootCount !== undefined) {
                rec.shootCount = g.items.reduce((s, i) => s + i.shootCount, 0);
            }
            if (g.items[0].qtyDelivered !== undefined) {
                rec.qtyDelivered = g.items.reduce((s, i) => s + i.qtyDelivered, 0);
                rec.qtyOk = g.items.reduce((s, i) => s + i.qtyOk, 0);
            }
            return rec;
        });
    }

    // ===== SHOOT LOG CRUD =====
    openShootLogModal(toolId, period = 'monthly') {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const monthNames = { '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April', '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus', '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember' };
        const monthShort = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'Mei', '06': 'Jun', '07': 'Jul', '08': 'Agu', '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Des' };
        const formatDateShort = (dateStr, monthFallback) => {
            if (dateStr) {
                const [y, mo, d] = dateStr.split('-');
                return `${parseInt(d)}-${monthShort[mo] || mo}-${y}`;
            }
            if (monthFallback) {
                const [y, mo] = monthFallback.split('-');
                return `1-${monthShort[mo] || mo}-${y}`;
            }
            return '-';
        };
        const rawLogs = (this.data.shootLogs || []).filter(l => l.toolId === toolId).sort((a, b) => a.month.localeCompare(b.month));
        const maxLife = t.maxShoot || 1000000;
        const isSupplier = this.currentUser.role === 'Pengguna Supplier';
        const lastShoot = rawLogs.reduce((sum, l) => sum + l.shootCount, 0);
        const logs = this.aggregatePeriods(rawLogs, period);
        const isAggregated = period !== 'monthly';
        const modalW = isAggregated ? 800 : 950;
        let cumSum = 0;
        const rows = logs.map((l, idx) => {
            cumSum += l.shootCount;
            const ratio = ((cumSum / maxLife) * 100).toFixed(1);
            return `<tr>
                <td>${idx + 1}</td>
                <td>${isAggregated ? l.month : formatDateShort(l.inputDate, l.month)}</td>
                <td class="font-semibold">${l.shootCount.toLocaleString('id-ID')}</td>
                <td class="font-semibold">${cumSum.toLocaleString('id-ID')}</td>
                <td><span class="badge ${parseFloat(ratio) >= 90 ? 'badge-danger' : parseFloat(ratio) >= 70 ? 'badge-warning' : 'badge-success'}">${ratio}%</span></td>
                ${isSupplier && !isAggregated ? (l.id
                    ? `<td><button class="btn btn-secondary btn-sm" onclick="app.openEditShootModal('${l.id}')" title="Edit" style="padding:0.25rem 0.5rem;font-size:0.75rem"><i class="fas fa-edit"></i></button> <button class="btn btn-danger btn-sm" onclick="app.submitDeleteShoot('${l.id}','${toolId}')" title="Hapus" style="padding:0.25rem 0.5rem;font-size:0.75rem"><i class="fas fa-trash"></i></button></td>`
                    : `<td><button class="btn btn-primary btn-sm" onclick="app.openAddShootModal('${toolId}','${l.month}')" title="Tambah" style="padding:0.25rem 0.5rem;font-size:0.75rem"><i class="fas fa-plus"></i></button></td>`) : (isAggregated ? '' : '')}
            </tr>`;
        }).join('');
        const chartData = logs.map((l, i) => {
            const s = logs.slice(0, i + 1).reduce((sum, x) => sum + x.shootCount, 0);
            let label;
            if (l.shortLabel) { label = l.shortLabel; }
            else { const [y, m] = l.month.split('-'); label = `${monthShort[m] || m}-${y.slice(-2)}`; }
            return { month: label, count: s };
        });
        const periods = [
            { key: 'monthly', label: 'Bulanan' },
            { key: 'quarterly', label: 'Kuartal' },
            { key: 'semester', label: 'Semester' },
            { key: 'fiscal', label: 'FY' }
        ];
        const pBtns = periods.map(p => `<button class="btn btn-sm" onclick="app.updateShootPeriod('${toolId}','${p.key}')" style="padding:0.35rem 0.9rem;font-size:0.8rem;border:1px solid var(--border-color);background:${p.key === period ? 'var(--accent-color)' : '#fff'};color:${p.key === period ? '#fff' : 'var(--text-primary)'};border-radius:var(--border-radius);cursor:pointer">${p.label}</button>`).join(' ');
        const modal = document.createElement('div');
        modal.id = 'shoot-log-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:${modalW}px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-chart-line" style="color:var(--accent-color);margin-right:0.5rem"></i>Riwayat Shoot � ${t.id} (${t.name})</h3><button class="modal-close" onclick="app.closeModal('shoot-log-modal')">&times;</button></div><div class="modal-body" style="max-height:80vh;overflow-y:auto">
            <div style="margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center">
                <div style="display:flex;align-items:center;gap:0.75rem">${pBtns}</div>
                ${isSupplier && !isAggregated ? `<button class="btn btn-primary btn-sm" onclick="app.openAddShootModal('${toolId}')"><i class="fas fa-plus"></i> Tambah Shoot</button>` : ''}
            </div>
            <div style="margin-bottom:1rem"><span class="info-label">Life Time</span> <span class="font-semibold">${lastShoot.toLocaleString('id-ID')} shot</span> &nbsp;|&nbsp; <span class="info-label">Life Tool Ratio</span> <span class="font-bold" style="color:var(--accent-color)">${(lastShoot / maxLife * 100).toFixed(1)}%</span> &nbsp;|&nbsp; <span class="info-label">Maximum Shoot</span> <span class="font-semibold">${maxLife.toLocaleString('id-ID')}</span></div>
            <div id="shoot-chart-wrap" style="background:#f8fafc;border:1px solid var(--border-color);border-radius:var(--border-radius);padding:1rem;margin-bottom:1rem"><canvas id="shoot-chart" width="900" height="280"></canvas></div>
            <div id="shoot-table-wrap" class="table-responsive"><table class="table" style="margin-bottom:0"><thead><tr><th>No.</th><th>${isAggregated ? 'Periode' : 'Tanggal Pengisian'}</th><th>Jumlah Shoot</th><th>Kumulatif Shoot</th><th>Life Tool Ratio</th>${isSupplier && !isAggregated ? '<th>Aksi</th>' : ''}</tr></thead><tbody>${rows || `<tr><td colspan="${isSupplier && !isAggregated ? 6 : 5}" style="text-align:center;padding:2rem;color:var(--text-secondary)">Belum ada data riwayat shoot.</td></tr>`}</tbody></table></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('shoot-log-modal')">Tutup</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        setTimeout(() => this.renderShootChart(chartData, maxLife, monthShort), 100);
    }

    updateShootPeriod(toolId, period) {
        this.closeModal('shoot-log-modal');
        setTimeout(() => this.openShootLogModal(toolId, period), 100);
    }

    renderShootChart(chartData, maxLife, monthShort) {
        const canvas = document.getElementById('shoot-chart');
        if (!canvas || chartData.length === 0) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const pad = { top: 30, right: 30, bottom: 65, left: 80 };
        const chartW = W - pad.left - pad.right, chartH = H - pad.top - pad.bottom;
        const maxVal = Math.max(...chartData.map(d => d.count), maxLife) * 1.1;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = pad.top + chartH - (i / 5) * chartH;
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
            ctx.fillStyle = '#64748b'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxVal * i / 5).toLocaleString('id-ID'), pad.left - 8, y + 4);
        }
        const points = chartData.map((d, i) => {
            const x = pad.left + (i / Math.max(chartData.length - 1, 1)) * chartW;
            const y = pad.top + chartH - (d.count / maxVal) * chartH;
            return { x, y, data: d };
        });
        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
        gradient.addColorStop(0, 'rgba(37,99,235,0.15)'); gradient.addColorStop(1, 'rgba(37,99,235,0)');
        ctx.beginPath(); ctx.moveTo(points[0].x, pad.top + chartH);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, pad.top + chartH); ctx.closePath();
        ctx.fillStyle = gradient; ctx.fill();
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
        points.forEach(p => {
            ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#2563eb'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#0f172a'; ctx.font = 'bold 11px Inter, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(p.data.count.toLocaleString('id-ID'), p.x, p.y - 12);
            ctx.save();
            ctx.translate(p.x, pad.top + chartH + 20);
            ctx.rotate(-Math.PI / 4);
            ctx.fillStyle = '#64748b'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right';
            ctx.fillText(p.data.month, 0, 0);
            ctx.restore();
        });
        ctx.beginPath(); ctx.setLineDash([5, 3]); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5;
        const lifeY = pad.top + chartH - (maxLife / maxVal) * chartH;
        ctx.moveTo(pad.left, lifeY); ctx.lineTo(W - pad.right, lifeY); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ef4444'; ctx.font = 'bold 11px Inter, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText('Max Lifetime: ' + maxLife.toLocaleString('id-ID'), W - pad.right, lifeY - 6);
        ctx.fillStyle = '#64748b'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Bulan', pad.left + chartW / 2, H - 8);
        ctx.save(); ctx.translate(14, pad.top + chartH / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('Jumlah Shoot', 0, 0); ctx.restore();
    }

    openAddShootModal(toolId, prefillMonth) {
        const defaultDate = prefillMonth ? `${prefillMonth}-01` : new Date().toISOString().slice(0, 10);
        const modal = document.createElement('div');
        modal.id = 'add-shoot-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-plus-circle" style="color:var(--accent-color);margin-right:0.5rem"></i>Tambah Riwayat Shoot</h3><button class="modal-close" onclick="app.closeModal('add-shoot-modal')">&times;</button></div><div class="modal-body">
            <div class="form-group"><label class="form-label">Tanggal Pengisian <span style="color:var(--danger-color)">*</span></label><input type="date" id="sh-tanggal" class="form-control" value="${defaultDate}"></div>
            <div class="form-group"><label class="form-label">Jumlah Shoot <span style="color:var(--danger-color)">*</span></label><input type="text" id="sh-count" class="form-control" placeholder="Contoh: 50.000" min="1"></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('add-shoot-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitAddShoot('${toolId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        this.initNumberFormat('sh-count');
    }

    async submitAddShoot(toolId) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const inputDate = document.getElementById('sh-tanggal')?.value;
        const count = this.parseFormattedNumber(document.getElementById('sh-count')?.value);
        if (!inputDate || isNaN(count) || count < 0) { alert('Harap isi tanggal pengisian dan jumlah shoot dengan benar.'); return; }
        const date = inputDate.slice(0, 7);
        const existingLogs = (this.data.shootLogs || []).filter(l => l.toolId === toolId);
        if (existingLogs.some(l => l.month === date)) { alert(`Bulan ${date} sudah ada data shoot. Silakan edit data yang sudah ada.`); return; }
        const maxId = this.data.shootLogs.reduce((max, l) => {
            const m = l.id.match(/SH-(\d+)/);
            return m ? Math.max(max, parseInt(m[1])) : max;
        }, 0);
        const newId = `SH-${String(maxId + 1).padStart(3, '0')}`;
        const newLog={ id: newId, toolId, month: date, inputDate, shootCount: count };
        this.data.shootLogs.push(newLog);
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.insertShootLog(newLog);}catch(e){console.error(e);alert('Gagal menyimpan shoot log ke database.');}
        }
        const logs = this.data.shootLogs.filter(l => l.toolId === toolId).sort((a, b) => a.month.localeCompare(b.month));
        const maxLife = t.maxShoot || 1000000;
        let cum = 0; logs.forEach(l => cum += l.shootCount);
        t.lifetime = `${cum.toLocaleString('id-ID')} / ${maxLife.toLocaleString('id-ID')}`;
        this.closeModal('add-shoot-modal'); this.closeModal('shoot-log-modal');
        alert(`Riwayat shoot ${newId} berhasil ditambahkan!`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    openEditShootModal(shootId) {
        const l = this.data.shootLogs.find(x => x.id === shootId);
        if (!l) return;
        const modal = document.createElement('div');
        modal.id = 'edit-shoot-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-edit" style="color:var(--accent-color);margin-right:0.5rem"></i>Ubah Riwayat Shoot: ${shootId}</h3><button class="modal-close" onclick="app.closeModal('edit-shoot-modal')">&times;</button></div><div class="modal-body">
            <div class="form-group"><label class="form-label">Tanggal Pengisian <span style="color:var(--danger-color)">*</span></label><input type="date" id="esh-tanggal" class="form-control" value="${l.inputDate || ''}"></div>
            <div class="form-group"><label class="form-label">Jumlah Shoot <span style="color:var(--danger-color)">*</span></label><input type="text" id="esh-count" class="form-control" value="${app.formatNumber(l.shootCount)}" min="1"></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('edit-shoot-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitEditShoot('${shootId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        this.initNumberFormat('esh-count');
    }

    async submitEditShoot(shootId) {
        const l = this.data.shootLogs.find(x => x.id === shootId);
        if (!l) return;
        const inputDate = document.getElementById('esh-tanggal')?.value;
        const count = this.parseFormattedNumber(document.getElementById('esh-count')?.value);
        if (!inputDate || isNaN(count) || count < 0) { alert('Harap isi tanggal pengisian dan jumlah shoot dengan benar.'); return; }
        const date = inputDate.slice(0, 7);
        const allLogs = (this.data.shootLogs || []).filter(x => x.toolId === l.toolId && x.id !== shootId);
        if (allLogs.some(x => x.month === date)) { alert(`Bulan ${date} sudah ada data shoot. Silakan edit data yang sudah ada.`); return; }
        l.month = date; l.inputDate = inputDate; l.shootCount = count;
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.updateShootLog(shootId, l);}catch(e){console.error(e);alert('Gagal memperbarui shoot log di database.');}
        }
        const t = this.data.toolings.find(x => x.id === l.toolId);
        if (t) {
            const logs = this.data.shootLogs.filter(x => x.toolId === l.toolId).sort((a, b) => a.month.localeCompare(b.month));
            const maxLife = t.maxShoot || 1000000;
            let cum = 0; logs.forEach(x => cum += x.shootCount);
            t.lifetime = `${cum.toLocaleString('id-ID')} / ${maxLife.toLocaleString('id-ID')}`;
        }
        this.closeModal('edit-shoot-modal'); this.closeModal('shoot-log-modal');
        alert(`Riwayat shoot ${shootId} berhasil diperbarui!`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    async submitDeleteShoot(shootId, toolId) {
        const idx = this.data.shootLogs.findIndex(x => x.id === shootId);
        if (idx === -1) return;
        if (!confirm(`Yakin ingin menghapus riwayat shoot ${shootId}?`)) return;
        this.data.shootLogs.splice(idx, 1);
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.deleteShootLog(shootId);}catch(e){console.error(e);alert('Gagal menghapus shoot log di database.');}
        }
        const t = this.data.toolings.find(x => x.id === toolId);
        if (t) {
            const logs = this.data.shootLogs.filter(x => x.toolId === toolId).sort((a, b) => a.month.localeCompare(b.month));
            const maxLife = t.maxShoot || 1000000;
            let cum = 0; logs.forEach(x => cum += x.shootCount);
            t.lifetime = `${cum.toLocaleString('id-ID')} / ${maxLife.toLocaleString('id-ID')}`;
        }
        this.closeModal('shoot-log-modal');
        alert(`Riwayat shoot ${shootId} berhasil dihapus.`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    // ===== PRODUCTION LOGS CRUD =====
    openAddProductionModal(toolId, prefillShootLogId) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const logs = (this.data.shootLogs || []).filter(l => l.toolId === toolId).sort((a,b)=> a.month.localeCompare(b.month));
        const pLogs = (this.data.productionLogs || []).filter(p => p.toolId === toolId);
        const available = logs.filter(l => !pLogs.some(p => p.shootLogId === l.id));
        const selected = prefillShootLogId || (available.length > 0 ? available[0].id : '');
        const qty = parseInt(t.qtyPerTooling) || 1;
        const optHtml = available.map(l => {
            const [y, m] = l.month.split('-');
            const monthNames = { '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April', '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus', '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember' };
            const dateStr = `${monthNames[m] || m} ${y}`;
            return `<option value="${l.id}" ${l.id===selected?'selected':''}>${dateStr} � Shoot: ${l.shootCount.toLocaleString('id-ID')} � Total Expected: ${(l.shootCount*qty).toLocaleString('id-ID')}</option>`;
        }).join('');
        if (available.length === 0) { alert('Semua periode shoot sudah memiliki data produksi.'); return; }
        const modal = document.createElement('div');
        modal.id = 'add-production-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:500px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-plus-circle" style="color:var(--accent-color);margin-right:0.5rem"></i>Tambah Data Produksi</h3><button class="modal-close" onclick="app.closeModal('add-production-modal')">&times;</button></div><div class="modal-body">
            <div class="form-group"><label class="form-label">Tooling</label><input class="form-control" value="${t.id} � ${t.name}" readonly style="background:#f1f5f9"></div>
            <div class="form-group"><label class="form-label">Periode Shoot <span style="color:var(--danger-color)">*</span></label><select id="ap-shoot" class="form-control">${optHtml}</select></div>
            <div class="form-group"><label class="form-label">Actual Part OK (pcs) <span style="color:var(--danger-color)">*</span></label><input type="text" id="ap-ok" class="form-control" placeholder="0"></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('add-production-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitAddProduction('${toolId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        this.initNumberFormat('ap-ok');
    }
    async submitAddProduction(toolId) {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const shootLogId = document.getElementById('ap-shoot')?.value;
        const okRaw = this.parseFormattedNumber(document.getElementById('ap-ok')?.value);
        if (!shootLogId) { alert('Harap pilih periode shoot.'); return; }
        if (!okRaw || okRaw <= 0) { alert('Harap isi Actual Part OK dengan benar.'); return; }
        const sl = this.data.shootLogs.find(s => s.id === shootLogId);
        if (!sl) { alert('Data shoot tidak ditemukan.'); return; }
        const qty = parseInt(t.qtyPerTooling) || 1;
        const totalExp = sl.shootCount * qty;
        if (okRaw > totalExp) { alert(`Actual Part OK (${okRaw.toLocaleString('id-ID')}) tidak boleh melebihi Total Expected (${totalExp.toLocaleString('id-ID')}).`); return; }
        const id = 'PR-' + String((this.data.productionLogs.length + 1)).padStart(3, '0');
        const newLog={ id, toolId, shootLogId, actualPartOk: okRaw };
        this.data.productionLogs.push(newLog);
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.insertProductionLog(newLog);}catch(e){console.error(e);alert('Gagal menyimpan produksi ke database.');}
        }
        this.closeModal('add-production-modal');
        alert(`Data produksi ${id} berhasil ditambahkan!`);
        document.getElementById('app-layout')?.remove(); this.router();
    }
    openEditProductionModal(productionId) {
        const p = this.data.productionLogs.find(x => x.id === productionId);
        if (!p) return;
        const sl = this.data.shootLogs.find(s => s.id === p.shootLogId);
        const t = this.data.toolings.find(x => x.id === p.toolId);
        if (!sl || !t) return;
        const qty = parseInt(t.qtyPerTooling) || 1;
        const totalExp = sl.shootCount * qty;
        const monthNames = { '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April', '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus', '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember' };
        const [sy, sm] = sl.month.split('-');
        const dateStr = `${monthNames[sm] || sm} ${sy}`;
        const modal = document.createElement('div');
        modal.id = 'edit-production-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-edit" style="color:var(--accent-color);margin-right:0.5rem"></i>Ubah Data Produksi: ${productionId}</h3><button class="modal-close" onclick="app.closeModal('edit-production-modal')">&times;</button></div><div class="modal-body">
            <div class="form-group"><label class="form-label">Tooling</label><input class="form-control" value="${t.id} � ${t.name}" readonly style="background:#f1f5f9"></div>
            <div class="form-group"><label class="form-label">Periode Shoot</label><input class="form-control" value="${dateStr} � Shoot: ${sl.shootCount.toLocaleString('id-ID')} � Total Expected: ${totalExp.toLocaleString('id-ID')}" readonly style="background:#f1f5f9"></div>
            <div class="form-group"><label class="form-label">Actual Part OK (pcs) <span style="color:var(--danger-color)">*</span></label><input type="text" id="ep-ok" class="form-control" value="${p.actualPartOk.toLocaleString('id-ID')}"></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('edit-production-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitEditProduction('${productionId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        this.initNumberFormat('ep-ok');
    }
    async submitEditProduction(productionId) {
        const p = this.data.productionLogs.find(x => x.id === productionId);
        if (!p) return;
        const okRaw = this.parseFormattedNumber(document.getElementById('ep-ok')?.value);
        if (!okRaw || okRaw <= 0) { alert('Harap isi Actual Part OK dengan benar.'); return; }
        const sl = this.data.shootLogs.find(s => s.id === p.shootLogId);
        const t = this.data.toolings.find(x => x.id === p.toolId);
        if (!sl || !t) return;
        const qty = parseInt(t.qtyPerTooling) || 1;
        const totalExp = sl.shootCount * qty;
        if (okRaw > totalExp) { alert(`Actual Part OK (${okRaw.toLocaleString('id-ID')}) tidak boleh melebihi Total Expected (${totalExp.toLocaleString('id-ID')}).`); return; }
        p.actualPartOk = okRaw;
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.updateProductionLog(productionId, p);}catch(e){console.error(e);alert('Gagal memperbarui produksi di database.');}
        }
        this.closeModal('edit-production-modal');
        alert(`Data produksi ${productionId} berhasil diperbarui!`);
        document.getElementById('app-layout')?.remove(); this.router();
    }
    async submitDeleteProduction(productionId, toolId) {
        const idx = this.data.productionLogs.findIndex(x => x.id === productionId);
        if (idx === -1) return;
        if (!confirm(`Yakin ingin menghapus data produksi ${productionId}?`)) return;
        this.data.productionLogs.splice(idx, 1);
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.deleteProductionLog(productionId);}catch(e){console.error(e);alert('Gagal menghapus produksi di database.');}
        }
        alert(`Data produksi ${productionId} berhasil dihapus.`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    // ===== DELIVERY LOGS MODAL & CRUD =====
    openDeliveryLogModal(toolId, period = 'monthly') {
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const rawLogs = (this.data.deliveryLogs || []).filter(l => l.toolId === toolId).sort((a, b) => a.month.localeCompare(b.month));
        const isEd = !this.currentUser.role.includes('Supplier');
        const totalDelivered = rawLogs.reduce((sum, l) => sum + (typeof l.qtyDelivered === 'number' ? l.qtyDelivered : 0), 0);
        const qtyPerTooling = parseInt(t.qtyPerTooling) || 1;
        const shootLogs = (this.data.shootLogs || []).filter(sl => sl.toolId === toolId);
        const cumShoot = shootLogs.reduce((sum, sl) => sum + sl.shootCount, 0);
        const matchedLogs = rawLogs.filter(l => shootLogs.some(s => s.month === l.month));
        const matchedQtyOk = matchedLogs.reduce((sum, l) => sum + (l.qtyOk || 0), 0);
        const cumRejectRatio = cumShoot > 0 ? ((1 - matchedQtyOk / (cumShoot * qtyPerTooling)) * 100) : 0;
        const monthShort = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'Mei', '06': 'Jun', '07': 'Jul', '08': 'Agu', '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Des' };
        const logs = this.aggregatePeriods(rawLogs, period);
        const isAggregated = period !== 'monthly';
        const modalW = isAggregated ? 900 : 800;
        const shootsAgg = this.aggregatePeriods(shootLogs, period);
        const rows = logs.map((l, idx) => {
            const qty = typeof l.qtyDelivered === 'number' ? l.qtyDelivered : parseInt(l.qtyDelivered) || 0;
            const qtyOk = l.qtyOk || 0;
            let ratioHtml = '-';
            if (isAggregated) {
                const sl = shootsAgg.find(s => s.month === l.month);
                if (sl && qtyPerTooling > 0) {
                    const expected = sl.shootCount * qtyPerTooling;
                    const ratio = expected > 0 ? ((1 - qtyOk / expected) * 100) : 0;
                    const cls = ratio < 5 ? 'badge-success' : ratio < 10 ? 'badge-warning' : 'badge-danger';
                    ratioHtml = `<span class="badge ${cls}">${ratio.toFixed(1)}%</span>`;
                }
            } else {
                const [y, m] = l.month.split('-');
                const sl = shootLogs.find(s => s.month === l.month);
                if (sl && qtyPerTooling > 0) {
                    const expected = sl.shootCount * qtyPerTooling;
                    const ratio = expected > 0 ? ((1 - qtyOk / expected) * 100) : 0;
                    const cls = ratio < 5 ? 'badge-success' : ratio < 10 ? 'badge-warning' : 'badge-danger';
                    ratioHtml = `<span class="badge ${cls}">${ratio.toFixed(1)}%</span>`;
                }
            }
            return `<tr>
                <td>${idx + 1}</td>
                <td>${isAggregated ? l.month : `1-${monthShort[l.month.split('-')[1]] || l.month.split('-')[1]}-${l.month.split('-')[0]}`}</td>
                <td class="font-semibold">${qty.toLocaleString('id-ID')}</td>
                <td class="font-semibold">${qtyOk.toLocaleString('id-ID')}</td>
                <td>${ratioHtml}</td>
                ${isEd && !isAggregated ? `<td><button class="btn btn-secondary btn-sm" onclick="app.openEditDeliveryModal('${l.id}')" title="Edit" style="padding:0.25rem 0.5rem;font-size:0.75rem"><i class="fas fa-edit"></i></button> <button class="btn btn-danger btn-sm" onclick="app.submitDeleteDelivery('${l.id}','${toolId}')" title="Hapus" style="padding:0.25rem 0.5rem;font-size:0.75rem"><i class="fas fa-trash"></i></button></td>` : ''}
            </tr>`;
        }).join('');
        const chartData = logs.map(l => {
            const qty = typeof l.qtyDelivered === 'number' ? l.qtyDelivered : parseInt(l.qtyDelivered) || 0;
            const qtyOk = l.qtyOk || 0;
            let ratio = null;
            if (isAggregated) {
                const sl = shootsAgg.find(s => s.month === l.month);
                const expected = sl ? sl.shootCount * qtyPerTooling : 0;
                if (expected > 0) ratio = ((1 - qtyOk / expected) * 100);
            } else {
                const sl = shootLogs.find(s => s.month === l.month);
                const expected = sl ? sl.shootCount * qtyPerTooling : 0;
                if (expected > 0) ratio = ((1 - qtyOk / expected) * 100);
            }
            let label;
            if (l.shortLabel) { label = l.shortLabel; }
            else { const [y, m] = l.month.split('-'); label = `${monthShort[m] || m}-${y.slice(-2)}`; }
            return { month: label, qty, ratio };
        });
        const periods = [
            { key: 'monthly', label: 'Bulanan' },
            { key: 'quarterly', label: 'Kuartal' },
            { key: 'semester', label: 'Semester' },
            { key: 'fiscal', label: 'FY' }
        ];
        const pBtns = periods.map(p => `<button class="btn btn-sm" onclick="app.updateDeliveryPeriod('${toolId}','${p.key}')" style="padding:0.35rem 0.9rem;font-size:0.8rem;border:1px solid var(--border-color);background:${p.key === period ? 'var(--accent-color)' : '#fff'};color:${p.key === period ? '#fff' : 'var(--text-primary)'};border-radius:var(--border-radius);cursor:pointer">${p.label}</button>`).join(' ');
        const modal = document.createElement('div');
        modal.id = 'delivery-log-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:${modalW}px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-truck" style="color:var(--accent-color);margin-right:0.5rem"></i>Riwayat Pengiriman Part � ${t.id} (${t.name})</h3><button class="modal-close" onclick="app.closeModal('delivery-log-modal')">&times;</button></div><div class="modal-body" style="max-height:70vh;overflow-y:auto">
            <div style="margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center">
                <div style="display:flex;align-items:center;gap:0.75rem">${pBtns}</div>
                ${isEd && !isAggregated && this.currentUser.role.includes('Admin') ? `<button class="btn btn-primary btn-sm" onclick="app.openAddDeliveryModal('${toolId}')"><i class="fas fa-plus"></i> Tambah Pengiriman</button>` : ''}
            </div>
            <div style="margin-bottom:1rem"><span class="info-label">Total Kirim</span> <span class="font-semibold">${totalDelivered.toLocaleString('id-ID')} pcs</span> &nbsp;|&nbsp; <span class="info-label">QTY OK (terhitung)</span> <span class="font-semibold">${matchedQtyOk.toLocaleString('id-ID')} pcs</span> &nbsp;|&nbsp; <span class="info-label">Reject Ratio</span> <span class="font-bold" style="color:var(--accent-color)">${cumRejectRatio.toFixed(1)}%</span> &nbsp;|&nbsp; <span class="info-label">Periode</span> <span class="font-semibold">${logs.length} ${isAggregated ? 'periode' : 'bulan'}</span></div>
            <div style="background:#f8fafc;border:1px solid var(--border-color);border-radius:var(--border-radius);padding:1rem;margin-bottom:1rem"><canvas id="delivery-chart" width="900" height="320"></canvas></div>
            <div class="table-responsive"><table class="table" style="margin-bottom:0"><thead><tr><th>No.</th><th>${isAggregated ? 'Periode' : 'Tanggal Pengisian'}</th><th>QTY Kirim (pcs)</th><th>QTY OK (pcs)</th><th>Total Reject Ratio (%)</th>${isEd && !isAggregated ? '<th>Aksi</th>' : ''}</tr></thead><tbody>${rows || `<tr><td colspan="${isEd && !isAggregated ? 6 : 5}" style="text-align:center;padding:2rem;color:var(--text-secondary)">Belum ada data pengiriman.</td></tr>`}</tbody></table></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('delivery-log-modal')">Tutup</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        setTimeout(() => this.renderDeliveryChart(chartData, monthShort), 100);
    }

    updateDeliveryPeriod(toolId, period) {
        this.closeModal('delivery-log-modal');
        setTimeout(() => this.openDeliveryLogModal(toolId, period), 100);
    }

    renderDeliveryChart(chartData, monthShort) {
        const canvas = document.getElementById('delivery-chart');
        if (!canvas || chartData.length === 0) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const pad = { top: 40, right: 70, bottom: 80, left: 80 };
        const chartW = W - pad.left - pad.right, chartH = H - pad.top - pad.bottom;
        const rawMax = Math.max(...chartData.map(d => d.qty), 0);
        const maxQty = Math.max(Math.ceil(rawMax / 10000) * 10000, 10000);
        const qtySteps = maxQty / 10000;
        const ratioSteps = 10;
        const adjMaxRatio = 10;
        ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
        for (let i = 0; i <= qtySteps; i++) {
            const frac = i / qtySteps;
            const y = pad.top + chartH - frac * chartH;
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
            ctx.fillStyle = '#64748b'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'right';
            ctx.fillText((i * 10000).toLocaleString('id-ID'), pad.left - 8, y + 4);
        }
        ctx.fillStyle = '#64748b'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
        for (let i = 0; i <= ratioSteps; i++) {
            const frac = i / ratioSteps;
            const y = pad.top + chartH - frac * chartH;
            ctx.fillText(i.toFixed(0) + '%', W - pad.right + 8, y + 4);
        }
        ctx.save(); ctx.translate(W - 8, pad.top + chartH / 2); ctx.rotate(Math.PI / 2);
        ctx.fillStyle = '#f97316'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Reject Ratio (%)', 0, 0); ctx.restore();
        const pts = chartData.map((d, i) => {
            const x = pad.left + (i / Math.max(chartData.length - 1, 1)) * chartW;
            const y = pad.top + chartH - (d.qty / maxQty) * chartH;
            return { x, y, data: d };
        });
        const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
        grad.addColorStop(0, 'rgba(16,185,129,0.15)'); grad.addColorStop(1, 'rgba(16,185,129,0)');
        ctx.beginPath(); ctx.moveTo(pts[0].x, pad.top + chartH);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length - 1].x, pad.top + chartH); ctx.closePath();
        ctx.fillStyle = grad; ctx.fill();
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
        const ratioPts = pts.filter(p => p.data.ratio !== null).map(p => ({
            x: p.x,
            y: pad.top + chartH - (p.data.ratio / adjMaxRatio) * chartH,
            data: p.data
        }));
        if (ratioPts.length > 1) {
            ctx.beginPath(); ctx.moveTo(ratioPts[0].x, ratioPts[0].y);
            ratioPts.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
        pts.forEach(p => {
            ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#10b981'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#0f172a'; ctx.font = 'bold 10px Inter, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(p.data.qty.toLocaleString('id-ID'), p.x, p.y - 10);
            ctx.save();
            ctx.translate(p.x, pad.top + chartH + 14);
            ctx.rotate(-Math.PI / 4);
            ctx.fillStyle = '#64748b'; ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'right';
            ctx.fillText(p.data.month, 0, 0);
            ctx.restore();
        });
        ratioPts.forEach(p => {
            ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#f97316'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#f97316'; ctx.font = 'bold 10px Inter, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(p.data.ratio.toFixed(1) + '%', p.x, p.y - 10);
        });
        ctx.fillStyle = '#64748b'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Bulan', pad.left + chartW / 2, H - 8);
        ctx.save(); ctx.translate(14, pad.top + chartH / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#10b981'; ctx.fillText('QTY Kirim (pcs)', 0, 0); ctx.restore();
        ctx.fillStyle = '#64748b'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'left';
        const lgX = pad.left + 10, lgY = pad.top - 12;
        ctx.fillStyle = '#10b981'; ctx.fillRect(lgX, lgY - 5, 12, 3);
        ctx.fillStyle = '#64748b'; ctx.fillText('QTY Kirim', lgX + 16, lgY);
        ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.moveTo(lgX + 90, lgY - 3); ctx.lineTo(lgX + 102, lgY - 3); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#64748b'; ctx.fillText('Reject Ratio', lgX + 106, lgY);
    }
    openAddDeliveryModal(toolId) {
        if (!this.currentUser.role.includes('Admin')) return;
        const modal = document.createElement('div');
        modal.id = 'add-delivery-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        modal.innerHTML = `<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-plus-circle" style="color:var(--accent-color);margin-right:0.5rem"></i>Tambah Pengiriman Part</h3><button class="modal-close" onclick="app.closeModal('add-delivery-modal')">&times;</button></div><div class="modal-body">
            <div class="form-group"><label class="form-label">Tanggal Pengisian <span style="color:var(--danger-color)">*</span></label><input type="date" id="dl-month" class="form-control"></div>
            <div class="form-group"><label class="form-label">QTY Kirim (pcs) <span style="color:var(--danger-color)">*</span></label><input type="text" id="dl-qty" class="form-control" placeholder="0"></div>
            <div class="form-group"><label class="form-label">QTY OK (pcs) <span style="color:var(--danger-color)">*</span></label><input type="text" id="dl-ok" class="form-control" placeholder="0"></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('add-delivery-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitAddDelivery('${toolId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        this.initNumberFormat('dl-qty');
        this.initNumberFormat('dl-ok');
    }
    async submitAddDelivery(toolId) {
        if (!this.currentUser.role.includes('Admin')) return;
        const t = this.data.toolings.find(x => x.id === toolId);
        if (!t) return;
        const inputDate = document.getElementById('dl-month')?.value;
        const qty = this.parseFormattedNumber(document.getElementById('dl-qty')?.value);
        const qtyOk = this.parseFormattedNumber(document.getElementById('dl-ok')?.value);
        if (!inputDate) { alert('Harap isi tanggal pengisian.'); return; }
        const month = inputDate.slice(0, 7);
        if (!qty || qty <= 0) { alert('Harap isi QTY Kirim dengan benar.'); return; }
        if (qtyOk === undefined || qtyOk === null || qtyOk < 0) { alert('Harap isi QTY OK dengan benar.'); return; }
        const exists = (this.data.deliveryLogs || []).find(d => d.toolId === toolId && d.month === month);
        if (exists) { alert(`Bulan ${month} sudah ada data pengiriman. Silakan edit data yang sudah ada.`); return; }
        const id = 'DL-' + String((this.data.deliveryLogs.length + 1)).padStart(3, '0');
        const newLog={ id, toolId, month, inputDate, qtyDelivered: qty, qtyOk: qtyOk || 0 };
        this.data.deliveryLogs.push(newLog);
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.insertDeliveryLog(newLog);}catch(e){console.error(e);alert('Gagal menyimpan pengiriman ke database.');}
        }
        this.closeModal('add-delivery-modal');
        alert(`Data pengiriman ${id} berhasil ditambahkan!`);
        document.getElementById('app-layout')?.remove(); this.router();
    }
    openEditDeliveryModal(deliveryId) {
        const l = this.data.deliveryLogs.find(x => x.id === deliveryId);
        if (!l) return;
        const modal = document.createElement('div');
        modal.id = 'edit-delivery-modal'; modal.className = 'modal-overlay'; modal.style.cssText = 'display:flex;opacity:1;visibility:visible;';
        const qty = typeof l.qtyDelivered === 'number' ? l.qtyDelivered : parseInt(l.qtyDelivered) || 0;
        modal.innerHTML = `<div class="modal-content" style="max-width:450px"><div class="modal-header"><h3 class="modal-title"><i class="fas fa-edit" style="color:var(--accent-color);margin-right:0.5rem"></i>Ubah Pengiriman: ${deliveryId}</h3><button class="modal-close" onclick="app.closeModal('edit-delivery-modal')">&times;</button></div><div class="modal-body">
            <div class="form-group"><label class="form-label">Tanggal Pengisian <span style="color:var(--danger-color)">*</span></label><input type="date" id="edl-month" class="form-control" value="${l.month}-01"></div>
            <div class="form-group"><label class="form-label">QTY Kirim (pcs) <span style="color:var(--danger-color)">*</span></label><input type="text" id="edl-qty" class="form-control" value="${app.formatNumber(qty)}"></div>
            <div class="form-group"><label class="form-label">QTY OK (pcs) <span style="color:var(--danger-color)">*</span></label><input type="text" id="edl-ok" class="form-control" value="${app.formatNumber(l.qtyOk || 0)}"></div>
        </div><div class="modal-footer"><button class="btn btn-secondary" onclick="app.closeModal('edit-delivery-modal')">Batal</button><button class="btn btn-primary" onclick="app.submitEditDelivery('${deliveryId}')"><i class="fas fa-save"></i> Simpan</button></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        this.initNumberFormat('edl-qty');
        this.initNumberFormat('edl-ok');
    }
    async submitEditDelivery(deliveryId) {
        const l = this.data.deliveryLogs.find(x => x.id === deliveryId);
        if (!l) return;
        const inputDate = document.getElementById('edl-month')?.value;
        const qty = this.parseFormattedNumber(document.getElementById('edl-qty')?.value);
        const qtyOk = this.parseFormattedNumber(document.getElementById('edl-ok')?.value);
        if (!inputDate) { alert('Harap isi tanggal pengisian.'); return; }
        const month = inputDate.slice(0, 7);
        if (!qty || qty <= 0) { alert('Harap isi QTY Kirim dengan benar.'); return; }
        if (qtyOk === undefined || qtyOk === null || qtyOk < 0) { alert('Harap isi QTY OK dengan benar.'); return; }
        const conflict = (this.data.deliveryLogs || []).find(d => d.toolId === l.toolId && d.month === month && d.id !== deliveryId);
        if (conflict) { alert(`Bulan ${month} sudah ada data pengiriman. Silakan edit data yang sudah ada.`); return; }
        l.month = month; l.inputDate = inputDate; l.qtyDelivered = qty; l.qtyOk = qtyOk || 0;
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.updateDeliveryLog(deliveryId, l);}catch(e){console.error(e);alert('Gagal memperbarui pengiriman di database.');}
        }
        this.closeModal('edit-delivery-modal'); this.closeModal('delivery-log-modal');
        alert(`Data pengiriman ${deliveryId} berhasil diperbarui!`);
        document.getElementById('app-layout')?.remove(); this.router();
    }
    async submitDeleteDelivery(deliveryId, toolId) {
        const idx = this.data.deliveryLogs.findIndex(x => x.id === deliveryId);
        if (idx === -1) return;
        if (!confirm(`Yakin ingin menghapus data pengiriman ${deliveryId}?`)) return;
        this.data.deliveryLogs.splice(idx, 1);
        if(window.DTMS && window.DTMS.enabled()){
            try{await window.DTMS.deleteDeliveryLog(deliveryId);}catch(e){console.error(e);alert('Gagal menghapus pengiriman di database.');}
        }
        this.closeModal('delivery-log-modal');
        alert(`Data pengiriman ${deliveryId} berhasil dihapus.`);
        document.getElementById('app-layout')?.remove(); this.router();
    }

    // ===== NUMBER FORMATTING HELPERS =====
    formatNumber(n) {
        return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
    parseFormattedNumber(str) {
        return parseInt(str.replace(/\./g, '')) || 0;
    }
    initNumberFormat(inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('input', function() {
            const pos = this.selectionStart;
            const oldLen = this.value.length;
            const raw = this.value.replace(/[^0-9]/g, '');
            this.value = raw ? app.formatNumber(parseInt(raw)) : '';
            const newLen = this.value.length;
            this.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen));
        });
    }

    // ===== CLOSE MODAL UTILITY =====
    closeModal(id) {
        const m=document.getElementById(id); if(m) m.remove(); document.body.style.overflow='';
    }
}

// Initialize App
const app = new App();
