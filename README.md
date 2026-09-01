# 🌍 WebGIS Pemantauan Tutupan Lahan — Kota Surakarta

Sistem **WebGIS** interaktif untuk memantau dan menganalisis perubahan tutupan lahan di Kota Surakarta. Dibangun dengan arsitektur *Decoupled Client-Server* menggunakan **FastAPI** (backend) dan **MapLibre GL JS** (frontend).

---

## 📋 Konteks

Proyek ini merupakan bagian dari Tugas Akhir / Skripsi yang bertujuan untuk membangun sistem informasi geografis berbasis web (*WebGIS*) guna menyediakan visualisasi dan analisis spasial perubahan tutupan lahan Kota Surakarta secara dinamis dan interaktif.

---

## ✨ Fitur Utama

### 🗺️ Visualisasi Peta Interaktif
- Rendering peta berbasis **WebGL/GPU** menggunakan MapLibre GL JS untuk performa tinggi
- Pop-up interaktif saat klik area poligon (nama kelas, luas dalam hektar)
- Kontrol navigasi, skala, dan zoom otomatis ke data

### 📊 Mode Analisis
- **Single-Year:** Visualisasi dan statistik tutupan lahan untuk satu tahun tertentu
- **Multi-Year (Change Detection):** Perbandingan dua tahun dengan overlay intersection menggunakan GeoPandas
  - Poligon *Tetap* ditampilkan transparan, poligon *Berubah* diwarnai penuh
  - Pop-up menampilkan Status (Berubah/Tetap), Kelas Tahun A, Kelas Tahun B, dan Luas

### 📋 Tabel Matriks Transisi
- Cross-tabulation matrix (*Transition Matrix*) perubahan lahan dalam Hektar
- Diagonal (area tidak berubah) diberi highlight hijau
- Total baris dan kolom dihitung otomatis

### 📦 Pemrosesan Data Spasial
- Upload file **GeoJSON**, **Shapefile (ZIP)**, atau **TIFF**
- Konversi otomatis SHP → GeoJSON dengan **geometry simplification** (`tolerance=1.0m`)
- Perhitungan luas akurat via proyeksi **UTM Zone 49S (EPSG:32749)**

### 🔐 Keamanan & Manajemen Akun
- Autentikasi **JWT (JSON Web Token)** untuk akses admin
- Password di-hash menggunakan **bcrypt**
- Endpoint untuk **tambah akun admin baru** dan **ganti password**
- Konfigurasi sensitif dimuat dari file `.env`

### 📱 Desain Responsif
- Antarmuka Dark Theme modern menggunakan Tailwind CSS
- Sidebar kolaps menjadi bottom-toggle pada layar mobile

---

## 🛠️ Tech Stack

| Layer | Teknologi |
|---|---|
| **Backend API** | Python 3.x, FastAPI, Uvicorn |
| **Analisis Spasial** | GeoPandas, Shapely, PyProj, Fiona |
| **Database** | SQLite + SQLAlchemy ORM |
| **Autentikasi** | JWT (python-jose), bcrypt |
| **Frontend** | HTML5, Vanilla JavaScript (ES6+) |
| **Peta** | MapLibre GL JS (WebGL) |
| **Styling** | Tailwind CSS (CDN), Custom CSS |
| **Konfigurasi** | python-dotenv (.env) |

---

## 📁 Struktur Direktori

```
WebGIS/
├── backend/
│   ├── main.py              # Entry point FastAPI
│   ├── database.py          # SQLite & SQLAlchemy models
│   ├── auth.py              # JWT, bcrypt, seed admin
│   ├── .env                 # Environment variables (SECRET_KEY, dll)
│   ├── requirements.txt     # Dependensi Python
│   ├── routers/
│   │   └── api.py           # Semua endpoint REST API
│   └── uploads/             # Penyimpanan file GeoJSON/SHP/TIFF
├── frontend/
│   ├── index.html           # Halaman utama WebGIS (Public)
│   ├── admin.html           # Dashboard Admin (Login + Kelola Data)
│   ├── css/
│   │   └── style.css        # Dark theme design system
│   └── js/
│       ├── map.js           # MapLibre, rendering, popup, statistik
│       └── admin.js         # Login, upload, CRUD, manajemen akun
├── CONTEXT.md               # Dokumen konteks proyek
└── README.md                # Dokumentasi ini
```

---

## 🚀 Setup & Instalasi

### Prasyarat
- **Python 3.10+** terinstal
- **pip** package manager
- Browser modern (Chrome, Firefox, Edge)

### 1. Clone / Download Proyek

```bash
cd WebGIS
```

### 2. Install Dependensi Python

```bash
cd backend
pip install -r requirements.txt
```

### 3. Konfigurasi Environment

Edit file `backend/.env` dan ubah `SECRET_KEY` untuk produksi:

```env
SECRET_KEY=ganti-dengan-kunci-rahasia-yang-kuat
DEFAULT_ADMIN_USER=admin
DEFAULT_ADMIN_PASS=defaultadmin321
CORS_ORIGINS=*
```

### 4. Jalankan Server

```bash
cd backend
uvicorn main:app --reload --port 8000
```

### 5. Akses Aplikasi

| Halaman | URL |
|---|---|
| **WebGIS (Peta)** | http://localhost:8000 |
| **Admin Dashboard** | http://localhost:8000/admin.html |
| **API Docs (Swagger)** | http://localhost:8000/api/docs |

### 6. Login Admin (Default)
- **Username:** `admin`
- **Password:** `defaultadmin321`

> ⚠️ **Segera ganti password default** setelah login pertama melalui menu "Ganti Password" di Dashboard Admin.

---

## 📡 API Endpoints

| Method   | Endpoint                             | Auth   | Deskripsi                               |
|----------|--------------------------------------|--------|-----------------------------------------|
| `POST`   | `/api/login`                         | ❌     | Login, mendapat JWT token               |
| `GET`    | `/api/data/years`                    | ❌     | Daftar tahun tersedia                   |
| `GET`    | `/api/data/geojson/{year}`           | ❌     | GeoJSON + statistik per tahun           |
| `GET`    | `/api/data/compare`                  | ❌     | Perbandingan statistik dua tahun        |
| `GET`    | `/api/data/matrix/{year_a}/{year_b}` | ❌     | Overlay intersection + matriks transisi |
| `POST`   | `/api/upload`                        | ✅ JWT | Upload file spasial                     |
| `GET`    | `/api/admin/data`                    | ✅ JWT | List data tersimpan                     |
| `DELETE` | `/api/admin/data/{id}`               | ✅ JWT | Hapus data                              |
| `POST`   | `/api/admin/users`                   | ✅ JWT | Tambah akun admin baru                  |
| `PUT`    | `/api/admin/password`                | ✅ JWT | Ganti password                          |

---

## 🏗️ Deployment Considerations

### Produksi
1. **Ubah `SECRET_KEY`** di `.env` menjadi string acak yang kuat (min. 32 karakter)
2. **Batasi CORS** — ubah `CORS_ORIGINS` menjadi domain spesifik (misal: `https://webgis.example.com`)
3. **Gunakan reverse proxy** (Nginx/Caddy) di depan Uvicorn
4. **Jalankan dengan Gunicorn** untuk multi-worker:
   ```bash
   gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
   ```
5. **Aktifkan HTTPS** menggunakan sertifikat SSL (Let's Encrypt)
6. **Ganti SQLite** ke PostgreSQL + PostGIS jika data spasial membesar

### Backup
- Database: `backend/webgis.db`
- File spasial: `backend/uploads/`

---

## 📄 Lisensi

Proyek ini dibuat untuk keperluan akademis (Skripsi).

---

*Dibangun dengan ❤️ menggunakan FastAPI, MapLibre GL JS, dan GeoPandas*
