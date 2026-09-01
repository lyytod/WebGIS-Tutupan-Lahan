"""
auth.py — JWT authentication helpers and default admin seeding.
Uses bcrypt directly (passlib is unmaintained and incompatible with bcrypt>=4.1).
Loads SECRET_KEY from environment / .env file.
"""

import os
from datetime import datetime, timedelta
from typing import Optional

# pyrefly: ignore [missing-import]
import bcrypt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database import User, SessionLocal, get_db

# ---------------------------------------------------------------------------
# Load .env file (looks for backend/.env or project root .env)
# ---------------------------------------------------------------------------
_backend_dir = os.path.dirname(os.path.abspath(__file__))
_dotenv_path = os.path.join(_backend_dir, ".env")
if not os.path.exists(_dotenv_path):
    _dotenv_path = os.path.join(_backend_dir, "..", ".env")
load_dotenv(_dotenv_path, override=False)

# ---------------------------------------------------------------------------
# Configuration — all secrets from env vars, NO hardcoded fallbacks in prod
# ---------------------------------------------------------------------------
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me-in-production")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))  # 24h

# Default seed credentials (from env; only used on first-run if DB is empty)
_DEFAULT_ADMIN_USER = os.getenv("DEFAULT_ADMIN_USER", "admin")
_DEFAULT_ADMIN_PASS = os.getenv("DEFAULT_ADMIN_PASS", "defaultadmin321")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")


# ---------------------------------------------------------------------------
# Password utilities (direct bcrypt — no passlib)
# ---------------------------------------------------------------------------
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


def hash_password(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")


# ---------------------------------------------------------------------------
# JWT utilities
# ---------------------------------------------------------------------------
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    """Dependency — validates JWT and returns the User row."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token tidak valid atau sudah kedaluwarsa.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user


# ---------------------------------------------------------------------------
# Seed default admin — only runs when the users table is COMPLETELY empty
# ---------------------------------------------------------------------------
def seed_admin():
    """Create a default admin account if there are zero users in the database."""
    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        if user_count == 0:
            admin = User(
                username=_DEFAULT_ADMIN_USER,
                hashed_password=hash_password(_DEFAULT_ADMIN_PASS),
            )
            db.add(admin)
            db.commit()
            print(f"[AUTH] Default admin user created (username: {_DEFAULT_ADMIN_USER})")
            print("[AUTH] ⚠  Change the default password immediately after first login!")
        else:
            print(f"[AUTH] {user_count} user(s) exist — skipping seed.")
    finally:
        db.close()
