"""
Auth Router — Login, registration, and user management endpoints.

Endpoints:
  POST /api/auth/login     — Authenticate with username + password, get JWT
  POST /api/auth/register  — Create a new user (admin only)
  GET  /api/auth/me        — Get current user's info (from JWT)
  GET  /api/auth/users     — List all users for impersonation dropdown (admin only)
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from typing import Optional

from app.services import auth_service
from app.dependencies.auth import get_current_user, require_admin

router = APIRouter()


# ── Request / Response models ──────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    user: dict


class RegisterRequest(BaseModel):
    username: str
    display_name: str
    password: str
    role_name: str
    email: Optional[str] = None


class UserInfo(BaseModel):
    user_id: int
    external_id: str
    display_name: str
    role_name: str
    email: Optional[str] = None
    impersonated_by: Optional[str] = None


# ── POST /api/auth/login ───────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, response: Response):
    """
    Authenticate with username and password. Sets an httpOnly cookie
    containing the JWT — the token is never exposed to JavaScript.
    """
    user = auth_service.authenticate_user(request.username, request.password)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password.",
        )

    token = auth_service.create_access_token(
        data={
            "sub": user["external_id"],
            "user_id": user["user_id"],
            "display_name": user["display_name"],
            "role": user["role_name"],
            "row_scope": user["row_scope"],
            "organization_id": user.get("organization_id"),
            "provider_id": user.get("provider_id"),
        }
    )

    response.set_cookie(
        key="q2i_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=auth_service.ACCESS_TOKEN_EXPIRE_HOURS * 3600,
        path="/",
    )

    return LoginResponse(
        user={
            "user_id": user["user_id"],
            "external_id": user["external_id"],
            "display_name": user["display_name"],
            "role_name": user["role_name"],
            "email": user.get("email"),
            "row_scope": user["row_scope"],
        },
    )


@router.post("/logout")
async def logout(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie(key="q2i_token", path="/", samesite="none", secure=True)
    return {"message": "Logged out"}


# ── GET /api/auth/me ─────────────────────────────────────────────

@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    """
    Returns the currently authenticated user's info.
    If an admin is impersonating another user, returns the
    impersonated user's info with an 'impersonated_by' field.
    """
    return user


# ── POST /api/auth/register ───────────────────────────────────

@router.post("/register")
async def register_user(
    request: RegisterRequest,
    admin: dict = Depends(require_admin),
):
    """
    Create a new user account. Admin-only endpoint.

    The admin specifies the username, display name, password, and role.
    The password is hashed with bcrypt before storage — the plain text
    is never persisted.
    """
    try:
        user = auth_service.create_user(
            external_id=request.username,
            display_name=request.display_name,
            password=request.password,
            role_name=request.role_name,
            email=request.email,
        )
        return {"message": f"User '{request.username}' created", "user": user}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        if "UNIQUE" in str(e).upper() or "duplicate" in str(e).lower():
            raise HTTPException(
                status_code=409,
                detail=f"Username '{request.username}' already exists.",
            )
        raise HTTPException(status_code=500, detail=str(e))


# ── GET /api/auth/users ───────────────────────────────────────

@router.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    """
    List all active users with their roles. Admin-only.
    Used by the frontend's impersonation dropdown — admin logs in
    once and can switch between any user to demo different roles.
    """
    import pyodbc
    from app.config import settings

    conn = pyodbc.connect(settings.sql_connection_string)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT
                u.external_id,
                u.display_name,
                u.email,
                r.role_name,
                r.description as role_description,
                r.row_scope
            FROM dbo.app_users u
            JOIN dbo.app_roles r ON u.role_id = r.role_id
            WHERE u.is_active = 1
            ORDER BY r.role_id
        """)
        users = []
        for row in cursor.fetchall():
            users.append({
                "external_id": row.external_id,
                "display_name": row.display_name,
                "email": row.email,
                "role_name": row.role_name,
                "role_description": row.role_description,
                "row_scope": row.row_scope,
            })
        return {"users": users}
    finally:
        cursor.close()
        conn.close()
