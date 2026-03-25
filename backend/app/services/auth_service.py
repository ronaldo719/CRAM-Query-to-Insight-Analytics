"""
Authentication Service — JWT-based auth with bcrypt password hashing.

This service handles three concerns:
  1. Password verification (bcrypt hash comparison)
  2. JWT token creation (issued on login, contains user_id and role)
  3. JWT token validation (called on every protected request)

Design decisions for the hackathon:
  - JWT tokens are stateless — no server-side session store needed.
    This means no Redis dependency just for auth.
  - Token expiry is set to 8 hours — long enough for a full demo session
    without re-login, short enough to be realistic.
  - The JWT payload includes role_name and external_id so the RBAC
    pipeline can start immediately without a database lookup on every
    request. The full RoleContext (with column restrictions, etc.)
    is still loaded from the database, but the basic identity check
    comes from the token itself.
  - Admin impersonation: if the logged-in user is an admin, they can
    send an X-Impersonate header to act as another user. This preserves
    the "role switcher" demo experience without requiring logout/login
    cycles. Only admins get this power.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import pyodbc
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

# ── Password hashing ─────────────────────────────────────────────
# bcrypt is the gold standard for password hashing: slow by design
# (prevents brute force), includes salt automatically, and is
# battle-tested across the industry.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── JWT configuration ────────────────────────────────────────────
# In production, SECRET_KEY should come from Key Vault. For the
# hackathon, an environment variable is fine.
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY environment variable is not set")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 8


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compare a plain text password against its bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


def hash_password(password: str) -> str:
    """Hash a plain text password with bcrypt. Used when creating new users."""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT token containing user identity and role info.

    The payload includes:
      - sub: the user's external_id (e.g., "demo_doctor")
      - user_id: database primary key
      - role: role_name (e.g., "physician")
      - display_name: human-readable name for the UI
      - exp: expiration timestamp

    This is enough info for the backend to identify the user and their
    role on every request without hitting the database. The full RBAC
    context (column restrictions, provider_id, etc.) is loaded from
    the database only when a query is actually executed.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """
    Decode and validate a JWT token. Returns the payload dict
    if valid, None if expired or tampered with.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def authenticate_user(username: str, password: str) -> Optional[dict]:
    """
    Verify credentials against the database and return user info if valid.

    Returns a dict with user details on success, None on failure.
    This is the only auth function that hits the database — all
    subsequent request validation uses the JWT token.
    """
    conn = pyodbc.connect(settings.sql_connection_string)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT
                u.user_id,
                u.external_id,
                u.display_name,
                u.email,
                u.password_hash,
                u.organization_id,
                u.provider_id,
                r.role_name,
                r.row_scope
            FROM dbo.app_users u
            JOIN dbo.app_roles r ON u.role_id = r.role_id
            WHERE u.external_id = ? AND u.is_active = 1
        """, (username,))

        row = cursor.fetchone()
        if not row:
            return None

        if not row.password_hash:
            return None

        if not verify_password(password, row.password_hash):
            return None

        # Update last login timestamp
        cursor.execute(
            "UPDATE dbo.app_users SET last_login = GETUTCDATE() WHERE user_id = ?",
            (row.user_id,),
        )
        conn.commit()

        return {
            "user_id": row.user_id,
            "external_id": row.external_id,
            "display_name": row.display_name,
            "email": row.email,
            "role_name": row.role_name,
            "row_scope": row.row_scope,
            "organization_id": str(row.organization_id) if row.organization_id else None,
            "provider_id": str(row.provider_id) if row.provider_id else None,
        }
    finally:
        cursor.close()
        conn.close()


def create_user(
    external_id: str,
    display_name: str,
    password: str,
    role_name: str,
    email: Optional[str] = None,
    organization_id: Optional[str] = None,
    provider_id: Optional[str] = None,
) -> dict:
    """
    Create a new user account. Only admins should call this.

    Returns the created user's info dict, or raises an exception
    if the username already exists or the role is invalid.
    """
    conn = pyodbc.connect(settings.sql_connection_string)
    cursor = conn.cursor()

    try:
        # Look up role_id from role_name
        cursor.execute(
            "SELECT role_id FROM dbo.app_roles WHERE role_name = ?",
            (role_name,),
        )
        role_row = cursor.fetchone()
        if not role_row:
            raise ValueError(f"Role '{role_name}' does not exist")

        hashed = hash_password(password)

        cursor.execute("""
            INSERT INTO dbo.app_users
                (external_id, display_name, email, role_id, password_hash,
                 organization_id, provider_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            external_id, display_name, email, role_row.role_id,
            hashed, organization_id, provider_id,
        ))
        conn.commit()

        return {
            "external_id": external_id,
            "display_name": display_name,
            "role_name": role_name,
        }
    finally:
        cursor.close()
        conn.close()
