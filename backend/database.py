"""
database.py — SQLAlchemy setup with SQLite for Users and SpatialData models.
"""

import os
from datetime import datetime

from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text
from sqlalchemy.orm import sessionmaker, declarative_base

# ---------------------------------------------------------------------------
# Database path — sits next to this file inside backend/
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = f"sqlite:///{os.path.join(BASE_DIR, 'webgis.db')}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)


class SpatialData(Base):
    __tablename__ = "spatial_data"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_type = Column(String(20), nullable=False)          # geojson | shp | tif
    year = Column(Integer, nullable=False, index=True)
    upload_date = Column(DateTime, default=datetime.utcnow)
    description = Column(Text, nullable=True)


# ---------------------------------------------------------------------------
# Utility — create all tables
# ---------------------------------------------------------------------------
def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency that yields a session and closes it afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
