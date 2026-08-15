// ============================================================
// DTMS Database Layer — REST API (Express + MySQL)
// ============================================================

const DTMS = (function () {
  const API_URL = (window.DTMS_API_URL || '').replace(/\/+$/, '');
  const isPlaceholder =
    !API_URL ||
    API_URL.includes('your-api') ||
    API_URL.includes('localhost:3000-change-me');

  const safeStorage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  let token = safeStorage.get('dtms_token') || null;

  function enabled() {
    return !isPlaceholder;
  }

  function authHeaders(extra = {}) {
    const h = { ...extra };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  async function api(path, options = {}) {
    const res = await fetch(API_URL + path, options);
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { ok: res.ok, status: res.status, body };
  }

  function toAuthUser(u) {
    if (!u) return u;
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      name: u.name,
      company: u.company,
      supplierId: u.supplierId || null,
      user_metadata: {
        username: u.username,
        role: u.role,
        name: u.name,
        company: u.company,
        supplierId: u.supplierId || null
      }
    };
  }

  function apiError(r, fallback) {
    const msg = (r && r.body && (r.body.error || r.body.detail)) || fallback || `HTTP ${r ? r.status : 'error'}`;
    return new Error(msg);
  }

  // ----------------------------
  // Auth
  // ----------------------------
  async function getSession() {
    if (isPlaceholder || !token) return { data: { session: null }, error: null };
    const r = await api('/api/auth/me', { headers: authHeaders() });
    if (!r.ok) {
      token = null;
      safeStorage.del('dtms_token');
      return { data: { session: null }, error: apiError(r) };
    }
    return { data: { session: { user: toAuthUser(r.body) } }, error: null };
  }

  async function getCurrentUser() {
    const { data: { session } } = await getSession();
    return session ? session.user : null;
  }

  async function login(email, password) {
    if (isPlaceholder) return { user: null, error: new Error('API tidak dikonfigurasi') };
    const r = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!r.ok || !r.body || !r.body.token) {
      return { user: null, error: apiError(r, 'Kredensial salah') };
    }
    token = r.body.token;
    safeStorage.set('dtms_token', token);
    return { user: toAuthUser(r.body.user), error: null };
  }

  async function logout() {
    token = null;
    safeStorage.del('dtms_token');
    return { error: null };
  }

  async function signUp(email, password, metadata = {}) {
    if (isPlaceholder) return { user: null, error: new Error('API tidak dikonfigurasi') };
    const r = await api('/api/auth/signup', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email, password, ...metadata })
    });
    if (!r.ok) return { user: null, error: apiError(r) };
    return { user: toAuthUser(r.body.user), error: null };
  }

  async function updateUserMetadata(metadata) {
    if (isPlaceholder) return { error: new Error('API tidak dikonfigurasi') };
    const r = await api('/api/auth/me/metadata', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ metadata })
    });
    if (!r.ok) return { error: apiError(r) };
    return { error: null };
  }

  async function deleteAuthUser(email) {
    if (isPlaceholder) return { error: new Error('API tidak dikonfigurasi') };
    const r = await api(`/api/auth/user/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!r.ok) return { error: apiError(r) };
    return { error: null };
  }

  async function updateAuthPassword(email, newPassword) {
    if (isPlaceholder) return { error: new Error('API tidak dikonfigurasi') };
    const r = await api(`/api/auth/user/${encodeURIComponent(email)}/password`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password: newPassword })
    });
    if (!r.ok) return { error: apiError(r) };
    return { error: null };
  }

  // ----------------------------
  // Load all collections
  // ----------------------------
  async function loadAll() {
    if (isPlaceholder) return null;
    try {
      const r = await api('/api/loadAll', { headers: authHeaders() });
      if (!r.ok) throw apiError(r);
      return r.body;
    } catch (err) {
      console.error('loadAll error:', err);
      return null;
    }
  }

  async function getKpis() {
    if (isPlaceholder) return null;
    const r = await api('/api/kpis', { headers: authHeaders() });
    if (!r.ok) return null;
    return r.body;
  }

  // ----------------------------
  // Generic CRUD helpers
  // ----------------------------
  async function list(table) {
    if (isPlaceholder) return [];
    const r = await api(`/api/${table}`, { headers: authHeaders() });
    if (!r.ok) return [];
    return r.body || [];
  }

  async function get(table, id) {
    if (isPlaceholder) return null;
    const r = await api(`/api/${table}/${encodeURIComponent(id)}`, { headers: authHeaders() });
    if (!r.ok) return null;
    return r.body;
  }

  async function insert(table, obj) {
    if (isPlaceholder) return null;
    const r = await api(`/api/${table}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(obj)
    });
    if (!r.ok) throw apiError(r, 'Gagal menyimpan data');
    return r.body;
  }

  async function update(table, id, obj) {
    if (isPlaceholder) return null;
    const r = await api(`/api/${table}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(obj)
    });
    if (!r.ok) throw apiError(r, 'Gagal memperbarui data');
    return r.body;
  }

  async function remove(table, id) {
    if (isPlaceholder) return false;
    const r = await api(`/api/${table}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!r.ok) throw apiError(r, 'Gagal menghapus data');
    return true;
  }

  // ----------------------------
  // Convenience methods used by app.js
  // ----------------------------
  async function insertTooling(obj) { return insert('toolings', obj); }
  async function updateTooling(id, obj) { return update('toolings', id, obj); }
  async function deleteTooling(id) { return remove('toolings', id); }

  async function insertMaintenanceLog(obj) { return insert('maintenanceLogs', obj); }
  async function updateMaintenanceLog(id, obj) { return update('maintenanceLogs', id, obj); }
  async function deleteMaintenanceLog(id) { return remove('maintenanceLogs', id); }

  async function insertSupplierTask(obj) { return insert('supplierTasks', obj); }
  async function updateSupplierTask(id, obj) { return update('supplierTasks', id, obj); }
  async function deleteSupplierTask(id) { return remove('supplierTasks', id); }

  async function insertShootLog(obj) { return insert('shootLogs', obj); }
  async function updateShootLog(id, obj) { return update('shootLogs', id, obj); }
  async function deleteShootLog(id) { return remove('shootLogs', id); }

  async function insertProductionLog(obj) { return insert('productionLogs', obj); }
  async function updateProductionLog(id, obj) { return update('productionLogs', id, obj); }
  async function deleteProductionLog(id) { return remove('productionLogs', id); }

  async function insertDeliveryLog(obj) { return insert('deliveryLogs', obj); }
  async function updateDeliveryLog(id, obj) { return update('deliveryLogs', id, obj); }
  async function deleteDeliveryLog(id) { return remove('deliveryLogs', id); }

  async function insertMovementLog(obj) { return insert('movementLogs', obj); }
  async function updateMovementLog(id, obj) { return update('movementLogs', id, obj); }
  async function deleteMovementLog(id) { return remove('movementLogs', id); }

  async function insertNotification(obj) { return insert('notifications', obj); }
  async function updateNotification(id, obj) { return update('notifications', id, obj); }
  async function deleteNotification(id) { return remove('notifications', id); }

  async function insertAuditLog(obj) { return insert('auditLogs', obj); }

  async function insertUser(obj) { return insert('users', obj); }
  async function updateUser(id, obj) { return update('users', id, obj); }
  async function deleteUser(id) { return remove('users', id); }

  function generatePassword() {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw;
  }

  // ----------------------------
  // File upload
  // ----------------------------
  async function uploadFile(bucket, file, path) {
    if (isPlaceholder) return { path: null, publicUrl: null, error: new Error('API tidak dikonfigurasi') };
    try {
      const form = new FormData();
      form.append('path', path);
      form.append('file', file);
      const r = await api('/api/upload', {
        method: 'POST',
        headers: { Authorization: token ? 'Bearer ' + token : '' },
        body: form
      });
      if (!r.ok) throw apiError(r, 'Upload gagal');
      return { path: r.body.path, publicUrl: r.body.publicUrl, error: null };
    } catch (error) {
      console.error('Upload error:', error);
      return { path: null, publicUrl: null, error };
    }
  }

  async function removeFile(bucket, path) {
    if (isPlaceholder) return { error: null };
    const r = await api(`/api/upload?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!r.ok) return { error: apiError(r) };
    return { error: null };
  }

  function getPublicUrl(bucket, path) {
    if (!path) return null;
    if (/^https?:\/\//.test(path)) return path;
    return API_URL + '/uploads/' + path;
  }

  // ----------------------------
  // Build a storage path
  // ----------------------------
  function makePath(table, recordId, fileName) {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${table}/${recordId}/${Date.now()}_${safeName}`;
  }

  return {
    enabled,
    isPlaceholder,
    getSession,
    getCurrentUser,
    login,
    logout,
    signUp,
    updateUserMetadata,
    loadAll,
    getKpis,
    list,
    get,
    insert,
    update,
    remove,
    insertTooling,
    updateTooling,
    deleteTooling,
    insertMaintenanceLog,
    updateMaintenanceLog,
    deleteMaintenanceLog,
    insertSupplierTask,
    updateSupplierTask,
    deleteSupplierTask,
    insertShootLog,
    updateShootLog,
    deleteShootLog,
    insertProductionLog,
    updateProductionLog,
    deleteProductionLog,
    insertDeliveryLog,
    updateDeliveryLog,
    deleteDeliveryLog,
    insertMovementLog,
    updateMovementLog,
    deleteMovementLog,
    insertNotification,
    updateNotification,
    deleteNotification,
    insertAuditLog,
    insertUser,
    updateUser,
    deleteUser,
    generatePassword,
    deleteAuthUser,
    updateAuthPassword,
    uploadFile,
    removeFile,
    getPublicUrl,
    makePath
  };
})();

window.DTMS = DTMS;
