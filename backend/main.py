"""
main.py — FastAPI entry point.
Initialises the database, seeds admin, mounts the frontend as static files.
Loads configuration from .env via python-dotenv.
"""

import os
import sys

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Ensure the backend package is importable & load .env
# ---------------------------------------------------------------------------
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BACKEND_DIR)

_dotenv_path = os.path.join(BACKEND_DIR, ".env")
if not os.path.exists(_dotenv_path):
    _dotenv_path = os.path.join(BACKEND_DIR, "..", ".env")
load_dotenv(_dotenv_path, override=False)

from database import init_db
from auth import seed_admin
from routers.api import router as api_router

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="WebGIS Pemantauan Tutupan Lahan — Kota Surakarta",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# ---------------------------------------------------------------------------
# CORS — configurable via CORS_ORIGINS env var
# Production: set CORS_ORIGINS=https://yourdomain.com
# Development: CORS_ORIGINS=* (default)
# ---------------------------------------------------------------------------
_cors_origins_raw = os.getenv("CORS_ORIGINS", "*")
if _cors_origins_raw.strip() == "*":
    _cors_origins = ["*"]
else:
    _cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Include the API router
app.include_router(api_router)

# ---------------------------------------------------------------------------
# Mount frontend as static files (must come AFTER API routes so /api/* wins)
# Uses os.path.abspath to prevent pathing issues during deployment.
# ---------------------------------------------------------------------------
FRONTEND_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "frontend"))

if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    print(f"[APP] Frontend mounted from: {FRONTEND_DIR}")
else:
    print(f"[WARN] Frontend directory not found at {FRONTEND_DIR}")


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
def on_startup():
    init_db()
    seed_admin()
    print("[APP] WebGIS API is running ✓")
