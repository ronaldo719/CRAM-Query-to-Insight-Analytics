"""
Auth Dependencies — FastAPI dependency injection for protected routes.

These are injected into route handlers via FastAPI's Depends() mechanism.
Any endpoint that needs authentication adds `user = Depends(get_current_user)`
to its parameter list, and FastAPI automatically extracts the JWT from the
Authorization header, validates it, and provides the user dict.

Two dependencies are provided:
  - get_current_user: returns the authenticated user (or 401)
  - get_current_user_or_none: returns None if no token (for optional auth)

Admin impersonation:
  If the authenticated user has role_name="admin" AND the request includes
  an X-Impersonate header with another user's external_id, the dependency
  returns that user's info instead. This lets the admin demo all 5 roles
  without logging out. Non-admin users with X-Impersonate get a 403.
"""

from typing import Optional
from fastapi import Cookie, Depends, HTTPException, Header

from app.services import auth_service


async def get_current_user(
    q2i_token: Optional[str] = Cookie(default=None),
    x_impersonate: Optional[str] = Header(default=None, alias="X-Impersonate"),
) -> dict:
    """
    Extract and validate the JWT token from the httpOnly cookie.
    Returns the user info dict from the token payload.

    If the user is an admin and X-Impersonate is set, returns the
    impersonated user's info instead (loaded from database).

    Raises 401 if no token or invalid token.
    Raises 403 if non-admin tries to impersonate.
    """
    if not q2i_token:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated. Please log in.",
        )

    payload = auth_service.decode_access_token(q2i_token)
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Token expired or invalid. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ── Admin impersonation ───────────────────────────────────
    # This is the key demo feature: the admin logs in once and can
    # switch between roles via the frontend dropdown. The dropdown
    # sends X-Impersonate: demo_nurse (or whatever), and this
    # dependency resolves it to that user's full identity.
    if x_impersonate and x_impersonate != payload.get("sub"):
        if payload.get("role") != "admin":
            raise HTTPException(
                status_code=403,
                detail="Only admins can impersonate other users.",
            )
        # Load the impersonated user from database
        impersonated = _load_user_from_db(x_impersonate)
        if not impersonated:
            raise HTTPException(
                status_code=404,
                detail=f"User '{x_impersonate}' not found.",
            )
        # Mark that this is an impersonated session (for audit logging)
        impersonated["impersonated_by"] = payload.get("sub")
        return impersonated

    return {
        "user_id": payload.get("user_id"),
        "external_id": payload.get("sub"),
        "display_name": payload.get("display_name"),
        "role_name": payload.get("role"),
        "row_scope": payload.get("row_scope"),
        "organization_id": payload.get("organization_id"),
        "provider_id": payload.get("provider_id"),
    }


async def get_current_user_or_none(
    q2i_token: Optional[str] = Cookie(default=None),
) -> Optional[dict]:
    """
    Same as get_current_user but returns None instead of 401.
    Used for endpoints that work with or without authentication.
    """
    if not q2i_token:
        return None
    payload = auth_service.decode_access_token(q2i_token)
    if not payload:
        return None
    return {
        "user_id": payload.get("user_id"),
        "external_id": payload.get("sub"),
        "display_name": payload.get("display_name"),
        "role_name": payload.get("role"),
        "row_scope": payload.get("row_scope"),
        "organization_id": payload.get("organization_id"),
        "provider_id": payload.get("provider_id"),
    }


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """
    Dependency that requires the authenticated user to be an admin.
    Used for user management endpoints (create user, etc.).
    """
    if user.get("role_name") != "admin":
        raise HTTPException(
            status_code=403,
            detail="This action requires admin privileges.",
        )
    return user


def _load_user_from_db(external_id: str) -> Optional[dict]:
    """Load a user's full info from the database for impersonation."""
    import pyodbc
    from app.config import settings

    conn = pyodbc.connect(settings.sql_connection_string)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT
                u.user_id, u.external_id, u.display_name, u.email,
                u.organization_id, u.provider_id,
                r.role_name, r.row_scope
            FROM dbo.app_users u
            JOIN dbo.app_roles r ON u.role_id = r.role_id
            WHERE u.external_id = ? AND u.is_active = 1
        """, (external_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "user_id": row.user_id,
            "external_id": row.external_id,
            "display_name": row.display_name,
            "role_name": row.role_name,
            "row_scope": row.row_scope,
            "organization_id": str(row.organization_id) if row.organization_id else None,
            "provider_id": str(row.provider_id) if row.provider_id else None,
        }
    finally:
        cursor.close()
        conn.close()