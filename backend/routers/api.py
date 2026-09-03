"""
routers/api.py — All REST endpoints for auth, file upload, data serving,
                  and spatial analysis (single-year stats & multi-year change detection).
"""

import os
import json
import uuid
import zipfile
import shutil
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db, SpatialData, User
from auth import (
    verify_password,
    hash_password,
    create_access_token,
    get_current_user,
)

router = APIRouter(prefix="/api", tags=["api"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "uploads")
# Fallback: if we're already inside backend/ use that
if not os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")):
    os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads"), exist_ok=True)
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")
UPLOAD_DIR = os.path.abspath(UPLOAD_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ───────────────────────────── AUTH ──────────────────────────────
@router.post("/login")
def login(username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Username atau password salah.")
    token = create_access_token(data={"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}


# ───────────────────────────── UPLOAD ────────────────────────────
ALLOWED_EXTENSIONS = {".geojson", ".zip", ".tif", ".tiff"}


def _save_upload(file: UploadFile) -> tuple[str, str]:
    """Save the uploaded file and return (saved_filename, file_type)."""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Tipe file '{ext}' tidak didukung. Gunakan .geojson, .zip (SHP), atau .tif")

    unique_name = f"{uuid.uuid4().hex}_{file.filename}"
    dest = os.path.join(UPLOAD_DIR, unique_name)

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Determine canonical type
    if ext == ".geojson":
        file_type = "geojson"
    elif ext == ".zip":
        file_type = "shp"
        # Extract the zip so shapefiles are accessible
        extract_dir = os.path.join(UPLOAD_DIR, unique_name.replace(".zip", "_shp"))
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(dest, "r") as zf:
            zf.extractall(extract_dir)
    elif ext in (".tif", ".tiff"):
        file_type = "tif"
    else:
        file_type = ext.strip(".")

    return unique_name, file_type


def _clear_matrix_cache():
    """Clear all cached multi-year matrix JSON files to prevent staleness."""
    try:
        for f in os.listdir(UPLOAD_DIR):
            if f.startswith("cache_matrix_") and f.endswith(".json"):
                try:
                    os.remove(os.path.join(UPLOAD_DIR, f))
                except Exception:
                    pass
    except Exception as e:
        print(f"[WARN] Failed to clear matrix cache: {e}")


@router.post("/upload")
def upload_file(
    file: UploadFile = File(...),
    year: int = Form(...),
    description: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    saved_name, file_type = _save_upload(file)

    record = SpatialData(
        filename=saved_name,
        original_filename=file.filename,
        file_type=file_type,
        year=year,
        description=description,
        upload_date=datetime.utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # If it's a shapefile zip, auto-convert to GeoJSON for serving
    if file_type == "shp":
        _convert_shp_to_geojson(saved_name, record.id, db)

    _clear_matrix_cache()

    return {
        "message": "Upload berhasil!",
        "id": record.id,
        "filename": record.original_filename,
        "file_type": file_type,
        "year": year,
    }


def _convert_shp_to_geojson(zip_filename: str, record_id: int, db: Session):
    """Convert an extracted shapefile to GeoJSON with geometry simplification."""
    try:
        import geopandas as gpd

        extract_dir = os.path.join(UPLOAD_DIR, zip_filename.replace(".zip", "_shp"))
        shp_files = [f for f in os.listdir(extract_dir) if f.endswith(".shp")]
        if not shp_files:
            return
        shp_path = os.path.join(extract_dir, shp_files[0])
        gdf = gpd.read_file(shp_path)

        # Reproject to WGS84 if needed
        if gdf.crs and not gdf.crs.is_geographic:
            gdf = gdf.to_crs(epsg=4326)
        elif not gdf.crs:
            gdf = gdf.set_crs(epsg=4326)

        # Simplify in projected CRS (UTM 49S) for accurate tolerance in metres,
        # then reproject back to WGS84 for serving.  tolerance=1.0 metre ≈
        # removes sub-metre vertex noise while keeping shape fidelity.
        gdf_proj = gdf.to_crs(epsg=32749)
        gdf_proj["geometry"] = gdf_proj.geometry.simplify(tolerance=1.0, preserve_topology=True)
        gdf = gdf_proj.to_crs(epsg=4326)

        geojson_name = zip_filename.replace(".zip", ".geojson")
        geojson_path = os.path.join(UPLOAD_DIR, geojson_name)
        gdf.to_file(geojson_path, driver="GeoJSON")
        print(f"[UPLOAD] SHP→GeoJSON OK (simplified, {len(gdf)} features) → {geojson_name}")

        # Update DB record with the converted file
        record = db.query(SpatialData).filter(SpatialData.id == record_id).first()
        if record:
            record.filename = geojson_name
            record.file_type = "geojson"
            db.commit()
    except Exception as e:
        print(f"[WARN] SHP→GeoJSON conversion failed: {e}")


# ───────────────────────── DATA ENDPOINTS ────────────────────────
@router.get("/data/years")
def get_available_years(db: Session = Depends(get_db)):
    rows = db.query(SpatialData.year).distinct().order_by(SpatialData.year).all()
    return {"years": [r[0] for r in rows]}


@router.get("/data/geojson/{year}")
def get_geojson_for_year(year: int, db: Session = Depends(get_db)):
    record = (
        db.query(SpatialData)
        .filter(SpatialData.year == year, SpatialData.file_type == "geojson")
        .order_by(SpatialData.upload_date.desc())
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail=f"Data GeoJSON untuk tahun {year} tidak ditemukan.")

    filepath = os.path.join(UPLOAD_DIR, record.filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File GeoJSON tidak ditemukan di server.")

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Compute area statistics (in hectares)
    stats = _compute_stats(filepath)

    return {"year": year, "geojson": data, "stats": stats}


@router.get("/data/compare")
def compare_years(year_a: int, year_b: int, db: Session = Depends(get_db)):
    """Multi-year change detection — computes area stats for both years."""
    record_a = (
        db.query(SpatialData)
        .filter(SpatialData.year == year_a, SpatialData.file_type == "geojson")
        .order_by(SpatialData.upload_date.desc())
        .first()
    )
    record_b = (
        db.query(SpatialData)
        .filter(SpatialData.year == year_b, SpatialData.file_type == "geojson")
        .order_by(SpatialData.upload_date.desc())
        .first()
    )
    if not record_a:
        raise HTTPException(status_code=404, detail=f"Data GeoJSON untuk tahun {year_a} tidak ditemukan.")
    if not record_b:
        raise HTTPException(status_code=404, detail=f"Data GeoJSON untuk tahun {year_b} tidak ditemukan.")

    path_a = os.path.join(UPLOAD_DIR, record_a.filename)
    path_b = os.path.join(UPLOAD_DIR, record_b.filename)

    if not os.path.exists(path_a) or not os.path.exists(path_b):
        raise HTTPException(status_code=404, detail="File GeoJSON tidak ditemukan di server.")

    with open(path_a, "r", encoding="utf-8") as f:
        geojson_a = json.load(f)
    with open(path_b, "r", encoding="utf-8") as f:
        geojson_b = json.load(f)

    stats_a = _compute_stats(path_a)
    stats_b = _compute_stats(path_b)

    # Compute change
    all_classes = sorted(set(list(stats_a.keys()) + list(stats_b.keys())))
    changes = {}
    for cls in all_classes:
        area_a = stats_a.get(cls, 0)
        area_b = stats_b.get(cls, 0)
        changes[cls] = {
            "year_a": round(area_a, 2),
            "year_b": round(area_b, 2),
            "change_ha": round(area_b - area_a, 2),
            "change_pct": round(((area_b - area_a) / area_a) * 100, 2) if area_a else 0,
        }

    return {
        "year_a": year_a,
        "year_b": year_b,
        "geojson_a": geojson_a,
        "geojson_b": geojson_b,
        "stats_a": stats_a,
        "stats_b": stats_b,
        "changes": changes,
    }


# ──────────────── TRANSITION MATRIX (OVERLAY) ───────────────────
def _resolve_geojson_path(year: int, db: Session) -> str:
    """Return the filesystem path for the latest GeoJSON for *year*, or raise 404."""
    record = (
        db.query(SpatialData)
        .filter(SpatialData.year == year, SpatialData.file_type == "geojson")
        .order_by(SpatialData.upload_date.desc())
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail=f"Data GeoJSON untuk tahun {year} tidak ditemukan.")
    path = os.path.join(UPLOAD_DIR, record.filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File GeoJSON tidak ditemukan di server.")
    return path


@router.get("/data/matrix/{year_a}/{year_b}")
def transition_matrix(year_a: int, year_b: int, db: Session = Depends(get_db)):
    """
    Multi-year change detection via spatial overlay (intersection).
    """
    cache_file = os.path.join(UPLOAD_DIR, f"cache_matrix_{year_a}_{year_b}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[WARN] Failed to read cache: {e}")

    import geopandas as gpd

    path_a = _resolve_geojson_path(year_a, db)
    path_b = _resolve_geojson_path(year_b, db)

    gdf_a = gpd.read_file(path_a)
    gdf_b = gpd.read_file(path_b)

    # Detect class columns
    col_a = _detect_class_col(gdf_a)
    col_b = _detect_class_col(gdf_b)

    # Keep only geometry + class column to reduce memory; rename to avoid collision
    gdf_a = gdf_a[["geometry", col_a]].rename(columns={col_a: "class_a"})
    gdf_b = gdf_b[["geometry", col_b]].rename(columns={col_b: "class_b"})

    # Dissolve by class to massively speed up intersection
    gdf_a = gdf_a.dissolve(by="class_a").reset_index()
    gdf_b = gdf_b.dissolve(by="class_b").reset_index()

    # Ensure both are WGS84
    for gdf in (gdf_a, gdf_b):
        if not gdf.crs:
            gdf.set_crs(epsg=4326, inplace=True)
        elif not gdf.crs.is_geographic:
            gdf.to_crs(epsg=4326, inplace=True)
        
        # Fix topological errors (e.g. self-intersections) before overlay
        gdf["geometry"] = gdf.geometry.buffer(0)

    # Overlay intersection
    gdf_inter = gpd.overlay(gdf_a, gdf_b, how="intersection", keep_geom_type=True)

    if gdf_inter.empty:
        return {
            "year_a": year_a, "year_b": year_b,
            "matrix": {}, "classes_a": [], "classes_b": [],
            "geojson": {"type": "FeatureCollection", "features": []},
        }

    # Compute area in hectares (project to UTM 49S)
    gdf_proj = gdf_inter.to_crs(epsg=32749)
    gdf_inter["area_ha"] = (gdf_proj.geometry.area / 10_000).round(4)

    # Status flag
    gdf_inter["class_a"] = gdf_inter["class_a"].astype(str)
    gdf_inter["class_b"] = gdf_inter["class_b"].astype(str)
    gdf_inter["status"] = gdf_inter.apply(
        lambda r: "Tetap" if r["class_a"] == r["class_b"] else "Berubah", axis=1
    )

    # Build transition matrix  {class_a: {class_b: total_ha}}
    grouped = gdf_inter.groupby(["class_a", "class_b"])["area_ha"].sum()
    classes_a = sorted(gdf_inter["class_a"].unique())
    classes_b = sorted(gdf_inter["class_b"].unique())
    matrix = {}
    for ca in classes_a:
        row = {}
        for cb in classes_b:
            row[cb] = round(grouped.get((ca, cb), 0), 2)
        matrix[ca] = row

    # Convert intersected result to GeoJSON (WGS84)
    gdf_out = gdf_inter[["geometry", "class_a", "class_b", "status", "area_ha"]]
    geojson_dict = json.loads(gdf_out.to_json())

    result = {
        "year_a": year_a,
        "year_b": year_b,
        "matrix": matrix,
        "classes_a": classes_a,
        "classes_b": classes_b,
        "geojson": geojson_dict,
    }
    
    # Save to cache
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(result, f)
    except Exception as e:
        print(f"[WARN] Failed to write cache: {e}")

    return result


def _detect_class_col(gdf) -> str:
    """Detect the land-cover class column in a GeoDataFrame."""
    candidates = [
        "Cls_Name", "cls_name", "Cls_ID", "cls_id",
        "class", "kelas", "classname", "class_name", "nama_kelas",
        "landcover", "land_cover", "tutupan", "Kelas", "Class",
        "CLASS", "CLASSNAME", "KELAS", "Nama_Kelas", "GRIDCODE",
        "gridcode", "DN", "dn", "REMARK", "remark", "Keterangan", "keterangan",
        "TUTUPAN", "tutupan_lahan", "Name", "name", "Desc", "desc", "Description"
    ]
    for c in candidates:
        if c in gdf.columns:
            return c
    for c in gdf.columns:
        if c != "geometry" and gdf[c].dtype == "object":
            return c
    # Nothing found — create a dummy
    gdf["class"] = "Unknown"
    return "class"


def _compute_stats(geojson_path: str) -> dict:
    """
    Compute per-class area statistics in Hectares from a GeoJSON file.
    Uses geopandas to reproject to a metric CRS (UTM zone 49S for Surakarta)
    for accurate area calculation.
    """
    try:
        import geopandas as gpd

        gdf = gpd.read_file(geojson_path)
        if gdf.empty:
            return {}

        # Detect the class name column
        class_col = _detect_class_col(gdf)

        # Reproject to UTM 49S (EPSG:32749) for metric area calculation — Surakarta region
        if gdf.crs and gdf.crs.is_geographic:
            gdf_proj = gdf.to_crs(epsg=32749)
        elif gdf.crs:
            gdf_proj = gdf.to_crs(epsg=32749)
        else:
            gdf.set_crs(epsg=4326, inplace=True)
            gdf_proj = gdf.to_crs(epsg=32749)

        gdf_proj["area_ha"] = gdf_proj.geometry.area / 10_000  # m² → hectares

        stats = gdf_proj.groupby(class_col)["area_ha"].sum().to_dict()
        stats = {str(k): round(v, 2) for k, v in stats.items()}
        return stats
    except Exception as e:
        print(f"[WARN] Stats computation failed: {e}")
        return {}


# ─────────────────────── ADMIN DATA MANAGEMENT ──────────────────
@router.get("/admin/data")
def list_all_data(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    records = db.query(SpatialData).order_by(SpatialData.upload_date.desc()).all()
    return {
        "data": [
            {
                "id": r.id,
                "original_filename": r.original_filename,
                "file_type": r.file_type,
                "year": r.year,
                "description": r.description or "",
                "upload_date": r.upload_date.isoformat() if r.upload_date else "",
            }
            for r in records
        ]
    }


@router.delete("/admin/data/{data_id}")
def delete_data(data_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    record = db.query(SpatialData).filter(SpatialData.id == data_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Data tidak ditemukan.")

    # Remove the file from disk
    filepath = os.path.join(UPLOAD_DIR, record.filename)
    if os.path.exists(filepath):
        os.remove(filepath)

    # Also remove extracted shp directory if exists
    shp_dir = os.path.join(UPLOAD_DIR, record.filename.replace(".geojson", "_shp").replace(".zip", "_shp"))
    if os.path.isdir(shp_dir):
        shutil.rmtree(shp_dir, ignore_errors=True)

    db.delete(record)
    db.commit()

    _clear_matrix_cache()

    return {"message": "Data berhasil dihapus."}


# ─────────────────────── ADMIN USER MANAGEMENT ──────────────────
@router.post("/admin/users")
def create_user(
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new admin account. Requires JWT authentication."""
    username = username.strip()
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username dan password tidak boleh kosong.")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter.")

    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Username '{username}' sudah digunakan.")

    new_user = User(
        username=username,
        hashed_password=hash_password(password),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": f"Akun '{username}' berhasil ditambahkan.", "id": new_user.id}


@router.put("/admin/password")
def change_password(
    old_password: str = Form(...),
    new_password: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change the currently logged-in user's password."""
    if not verify_password(old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Password lama salah.")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password baru minimal 6 karakter.")

    current_user.hashed_password = hash_password(new_password)
    db.commit()
    return {"message": "Password berhasil diubah."}
