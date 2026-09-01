/**
 * admin.js — Admin dashboard logic: login, JWT storage,
 *            file upload, data listing, and deletion.
 */

const API_BASE = window.location.origin;
const TOKEN_KEY = 'webgis_admin_token';

// ─────────────────────── INIT ───────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    showDashboard();
    fetchDataList();
  } else {
    showLogin();
  }
});

// ─────────────────────── VIEW TOGGLE ───────────────────────
function showLogin() {
  document.getElementById('login-view').style.display = '';
  document.getElementById('dashboard-view').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
}

function showDashboard() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('dashboard-view').style.display = '';
  document.getElementById('btn-logout').style.display = '';
}

// ─────────────────────── LOGIN ───────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    errEl.textContent = 'Username dan password wajib diisi.';
    errEl.style.display = 'block';
    return;
  }

  try {
    const form = new URLSearchParams();
    form.append('username', username);
    form.append('password', password);

    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Username atau Password Salah!');
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Login gagal.');
    }

    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.access_token);
    showDashboard();
    fetchDataList();
    showToast('Login berhasil!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─────────────────────── LOGOUT ───────────────────────
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
  showToast('Berhasil logout.', 'info');
}

// ─────────────────────── FILE SELECTION ───────────────────────
function onFileSelected(input) {
  const nameEl = document.getElementById('selected-file-name');
  if (input.files && input.files.length > 0) {
    nameEl.textContent = `✓ ${input.files[0].name}`;
  } else {
    nameEl.textContent = '';
  }
}

// ─────────────────────── UPLOAD ───────────────────────
async function handleUpload(e) {
  e.preventDefault();
  const successEl = document.getElementById('upload-success');
  const errorEl = document.getElementById('upload-error');
  successEl.style.display = 'none';
  errorEl.style.display = 'none';

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showLogin();
    return;
  }

  const fileInput = document.getElementById('upload-file');
  const year = document.getElementById('upload-year').value;
  const description = document.getElementById('upload-desc').value || '';

  if (!fileInput.files || fileInput.files.length === 0) {
    errorEl.textContent = 'Pilih file untuk diupload.';
    errorEl.style.display = 'block';
    return;
  }
  if (!year) {
    errorEl.textContent = 'Tahun data wajib diisi.';
    errorEl.style.display = 'block';
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('year', year);
  formData.append('description', description);

  const btn = document.getElementById('btn-upload');
  btn.disabled = true;
  btn.innerHTML = '⏳ Mengupload...';

  try {
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      showToast('Sesi berakhir. Silakan login kembali.', 'error');
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Upload gagal.');
    }

    const data = await res.json();
    successEl.textContent = `✓ ${data.message} — ${data.original_filename || data.filename}`;
    successEl.style.display = 'block';

    // Reset form
    document.getElementById('upload-form').reset();
    document.getElementById('selected-file-name').textContent = '';

    // Refresh table
    fetchDataList();
    showToast('Upload berhasil!', 'success');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    showToast('Upload gagal.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⬆️ Upload';
  }
}

// ─────────────────────── FETCH & RENDER DATA TABLE ───────────────────────
async function fetchDataList() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  const container = document.getElementById('data-table-container');

  try {
    const res = await fetch(`${API_BASE}/api/admin/data`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      return;
    }

    const result = await res.json();
    const records = result.data || [];

    if (records.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">📂</div>
          <div class="empty-state__text">Belum ada data terupload</div>
          <div class="empty-state__hint">Gunakan form di atas untuk mengunggah data spasial</div>
        </div>
      `;
      return;
    }

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Nama File</th>
            <th>Tipe</th>
            <th>Tahun</th>
            <th>Tanggal Upload</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
    `;

    records.forEach(r => {
      const badgeClass = r.file_type === 'geojson' ? 'badge--geojson' :
        r.file_type === 'shp' ? 'badge--shp' : 'badge--tif';
      const dateStr = r.upload_date ? new Date(r.upload_date).toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
      }) : '-';

      html += `
        <tr>
          <td style="font-weight:500;">${escapeHtml(r.original_filename)}</td>
          <td><span class="badge ${badgeClass}">${r.file_type.toUpperCase()}</span></td>
          <td>${r.year}</td>
          <td style="color:var(--color-text-muted);">${dateStr}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="deleteData(${r.id}, '${escapeHtml(r.original_filename)}')">
              🗑 Hapus
            </button>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    console.error(err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">⚠️</div>
        <div class="empty-state__text">Gagal memuat data</div>
      </div>
    `;
  }
}

// ─────────────────────── DELETE ───────────────────────
async function deleteData(id, filename) {
  if (!confirm(`Hapus data "${filename}"? Tindakan ini tidak dapat dibatalkan.`)) return;

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showLogin();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/data/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      showToast('Sesi berakhir.', 'error');
      return;
    }

    if (!res.ok) throw new Error('Gagal menghapus data.');

    showToast('Data berhasil dihapus.', 'success');
    fetchDataList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─────────────────────── CREATE NEW ADMIN ───────────────────────
async function handleCreateUser(e) {
  e.preventDefault();
  const successEl = document.getElementById('create-user-success');
  const errorEl = document.getElementById('create-user-error');
  successEl.style.display = 'none';
  errorEl.style.display = 'none';

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { showLogin(); return; }

  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('new-password').value;

  if (!username || !password) {
    errorEl.textContent = 'Username dan password wajib diisi.';
    errorEl.style.display = 'block';
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = 'Password minimal 6 karakter.';
    errorEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('btn-create-user');
  btn.disabled = true;

  try {
    const form = new URLSearchParams();
    form.append('username', username);
    form.append('password', password);

    const res = await fetch(`${API_BASE}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`,
      },
      body: form.toString(),
    });

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      showToast('Sesi berakhir.', 'error');
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Gagal menambahkan akun.');

    successEl.textContent = `✓ ${data.message}`;
    successEl.style.display = 'block';
    document.getElementById('create-user-form').reset();
    showToast('Akun berhasil ditambahkan!', 'success');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}


// ─────────────────────── CHANGE PASSWORD ───────────────────────
async function handleChangePassword(e) {
  e.preventDefault();
  const successEl = document.getElementById('change-pw-success');
  const errorEl = document.getElementById('change-pw-error');
  successEl.style.display = 'none';
  errorEl.style.display = 'none';

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { showLogin(); return; }

  const oldPassword = document.getElementById('old-password').value;
  const newPassword = document.getElementById('new-pw').value;

  if (!oldPassword || !newPassword) {
    errorEl.textContent = 'Semua field wajib diisi.';
    errorEl.style.display = 'block';
    return;
  }
  if (newPassword.length < 6) {
    errorEl.textContent = 'Password baru minimal 6 karakter.';
    errorEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('btn-change-pw');
  btn.disabled = true;

  try {
    const form = new URLSearchParams();
    form.append('old_password', oldPassword);
    form.append('new_password', newPassword);

    const res = await fetch(`${API_BASE}/api/admin/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`,
      },
      body: form.toString(),
    });

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      showToast('Sesi berakhir.', 'error');
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Gagal mengubah password.');

    successEl.textContent = `✓ ${data.message}`;
    successEl.style.display = 'block';
    document.getElementById('change-pw-form').reset();
    showToast('Password berhasil diubah!', 'success');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}


// ─────────────────────── UTILS ───────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast--${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3500);
}
