## 1. DESKRIPSI SISTEM & HAK AKSES (USER ROLES)
Sistem WebGIS ini menggunakan arsitektur Decoupled (Client-Server) yang responsif (mendukung Mobile, Tablet, Desktop) dengan dua peran pengguna:
1. **GUEST / PUBLIC USER (Tanpa Login):**
   - Mengakses dasbor WebGIS utama.
   - **Mode Single-Year:** Memilih satu tahun tertentu untuk melihat peta tutupan lahan dan grafik statistik luas area (dalam Hektar).
   - **Mode Multi-Year (Change Detection):** Memilih dua tahun berbeda (Tahun A vs Tahun B) untuk melihat visualisasi dan statistik perubahan lahan secara dinamis.
   - **Peta Interaktif:** Mengklik area/poligon di peta untuk memunculkan *pop-up* informasi spasial (kelas lahan, luas hektar, dll).
2. **ADMIN (Wajib Login):**
   - Memiliki kredensial aman (JWT Authentication).
   - Mengakses panel *Dashboard Admin*.
   - **CRUD Data Spasial:** Mengunggah file Vektor (SHP dalam ZIP / GeoJSON) atau Raster (TIFF), memberikan keterangan/metadata tahun data, serta dapat mengedit atau menghapus data yang sudah ada di database.

---

## 2. ARSITEKTUR TEKNOLOGI (TECH STACK)
Untuk menjamin performa saat menangani data spasial berdimensi besar tanpa *reload/rerun* seperti Streamlit:
- **Backend (API & Pengolahan Data):** FastAPI (Python). Mengelola endpoint autentikasi, upload file, dan melayani GeoJSON ke *frontend*. Menghitung operasi spasial (misal: membandingkan luas tahun A dan B) menggunakan `geopandas`.
- **Database:** SQLite (menggunakan SQLAlchemy) untuk menyimpan tabel `users` (admin) dan `spatial_data` (metadata tahun, path file, tipe file).
- **Frontend (UI & Map):** HTML5, Vanilla JavaScript (atau framework ringan), dan **Tailwind CSS** untuk antarmuka yang 100% responsif.
- **Library Peta:** **MapLibre GL JS** (berbasis WebGL/GPU) untuk merender poligon vektor ukuran besar secara super mulus.

---

## 3. STRUKTUR DIREKTORI PROYEK

WebGIS/
├── backend/
│   ├── main.py              # Entry point FastAPI
│   ├── database.py          # Konfigurasi SQLite & SQLAlchemy models
│   ├── auth.py              # Logika Login & JWT Token
│   ├── routers/             # Endpoint API terpisah (data.py, admin.py, map.py)
│   ├── uploads/             # Folder penyimpanan file SHP/ZIP/TIFF dari Admin
│   └── requirements.txt     # fastapi, uvicorn, geopandas, sqlalchemy, python-jose, passlib
├── frontend/
│   ├── index.html           # Halaman utama WebGIS (Public)
│   ├── admin.html           # Halaman panel Admin (Upload & Manage Data)
│   ├── css/
│   │   └── style.css        # Konfigurasi Tailwind & Custom CSS
│   └── js/
│       ├── map.js           # Logika MapLibre, pop-up klik, & pemuatan GeoJSON
│       ├── api.js           # Fetch API ke FastAPI
│       └── admin.js         # Logika form login, upload data, & tabel manajemen
└── CONTEXT.md               # File instruksi master

## 4. ALUR KERJA (WORKFLOW) & ATURAN KODE

Prioritas Tampilan Responsif: Antarmuka harus menyesuaikan diri. Panel kontrol (pilihan tahun & grafik) berada di sidebar pada layar besar, dan menjadi bottom sheet/drawer pada layar mobile.

Efisiensi Data Multi-Year: Saat user meminta perbandingan Multi-Year, backend FastAPI harus menghitung persilangan (intersection) data luas lahan menggunakan Geopandas dan mengirimkan data JSON ringkas (statistik hektar) ke frontend untuk dijadikan grafik, sehingga browser tidak hang.

Satuan Mutlak: Seluruh perhitungan luas wajib dikonversi dan ditampilkan dalam satuan Hektar (Ha).