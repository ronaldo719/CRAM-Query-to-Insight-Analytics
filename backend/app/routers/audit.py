"""
Audit Log Router -- Query audit trail API.

Provides endpoints for viewing the complete history of query attempts,
including who asked what, what SQL was generated, whether it was modified
or denied, and why. This is a key Responsible AI accountability feature.

Endpoints:
  GET /api/audit/log         -- List recent audit entries (admin only)
  GET /api/audit/log/{id}    -- Get a single audit entry detail
  GET /api/audit/stats       -- Aggregate audit statistics
"""

from fastapi import APIRouter, Depends, Query
from typing import Optional
import pyodbc

from app.config import settings
from app.dependencies.auth import require_admin

router = APIRouter()


@router.get("/log")
async def get_audit_log(
    admin: dict = Depends(require_admin),
    limit: int = Query(default=50, le=200),
    role_name: Optional[str] = Query(default=None),
    denied_only: bool = Query(default=False),
    user_id: Optional[int] = Query(default=None),
):
    """
    List recent audit entries. Admin-only.
    Supports filtering by role, denied status, and specific user.
    """
    conn = pyodbc.connect(settings.sql_connection_string)
    cursor = conn.cursor()

    try:
        where_clauses = ["1=1"]
        params = []

        if role_name:
            where_clauses.append("a.role_name = ?")
            params.append(role_name)

        if denied_only:
            where_clauses.append("a.was_denied = 1")

        if user_id:
            where_clauses.append("a.user_id = ?")
            params.append(user_id)

        where_sql = " AND ".join(where_clauses)

        cursor.execute(f"""
            SELECT TOP (?)
                a.log_id,
                a.user_id,
                u.display_name,
                u.external_id,
                a.role_name,
                a.natural_language_query,
                a.generated_sql,
                a.final_executed_sql,
                a.was_modified,
                a.was_denied,
                a.denial_reason,
                a.tables_accessed,
                a.row_count_returned,
                a.execution_time_ms,
                a.content_safety_score,
                a.sensitivity_classification,
                a.created_at
            FROM dbo.app_query_audit_log a
            LEFT JOIN dbo.app_users u ON a.user_id = u.user_id
            WHERE {where_sql}
            ORDER BY a.created_at DESC
        """, [limit] + params)

        entries = []
        for row in cursor.fetchall():
            entries.append({
                "log_id": row.log_id,
                "user_id": row.user_id,
                "display_name": row.display_name,
                "external_id": row.external_id,
                "role_name": row.role_name,
                "question": row.natural_language_query,
                "generated_sql": row.generated_sql,
                "executed_sql": row.final_executed_sql,
                "was_modified": row.was_modified,
                "was_denied": row.was_denied,
                "denial_reason": row.denial_reason,
                "tables_accessed": row.tables_accessed,
                "row_count": row.row_count_returned,
                "execution_time_ms": row.execution_time_ms,
                "content_safety_score": row.content_safety_score,
                "sensitivity": row.sensitivity_classification,
                "timestamp": str(row.created_at) if row.created_at else None,
            })

        return {"entries": entries, "count": len(entries)}

    finally:
        cursor.close()
        conn.close()


@router.get("/stats")
async def get_audit_stats(admin: dict = Depends(require_admin)):
    """
    Aggregate audit statistics -- total queries, denial rate, avg latency, etc.
    Useful for the Responsible AI dashboard panel in the frontend.
    """
    conn = pyodbc.connect(settings.sql_connection_string)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT
                COUNT(*) as total_queries,
                SUM(CASE WHEN was_denied = 1 THEN 1 ELSE 0 END) as denied_count,
                SUM(CASE WHEN was_modified = 1 THEN 1 ELSE 0 END) as modified_count,
                AVG(execution_time_ms) as avg_latency_ms,
                MAX(execution_time_ms) as max_latency_ms,
                AVG(row_count_returned) as avg_rows_returned
            FROM dbo.app_query_audit_log
        """)
        row = cursor.fetchone()

        # Queries by role
        cursor.execute("""
            SELECT role_name, COUNT(*) as query_count,
                   SUM(CASE WHEN was_denied = 1 THEN 1 ELSE 0 END) as denied
            FROM dbo.app_query_audit_log
            GROUP BY role_name
            ORDER BY query_count DESC
        """)
        by_role = [
            {"role": r.role_name, "queries": r.query_count, "denied": r.denied}
            for r in cursor.fetchall()
        ]

        # Recent denials
        cursor.execute("""
            SELECT TOP 5
                a.role_name, a.natural_language_query, a.denial_reason,
                a.created_at, u.display_name
            FROM dbo.app_query_audit_log a
            LEFT JOIN dbo.app_users u ON a.user_id = u.user_id
            WHERE a.was_denied = 1
            ORDER BY a.created_at DESC
        """)
        recent_denials = [
            {
                "role": r.role_name,
                "question": r.natural_language_query[:100],
                "reason": r.denial_reason[:200] if r.denial_reason else "",
                "user": r.display_name,
                "timestamp": str(r.created_at),
            }
            for r in cursor.fetchall()
        ]

        return {
            "total_queries": row.total_queries or 0,
            "denied_count": row.denied_count or 0,
            "modified_count": row.modified_count or 0,
            "denial_rate": round((row.denied_count or 0) / max(row.total_queries or 1, 1) * 100, 1),
            "avg_latency_ms": round(row.avg_latency_ms or 0),
            "max_latency_ms": row.max_latency_ms or 0,
            "avg_rows_returned": round(row.avg_rows_returned or 0),
            "by_role": by_role,
            "recent_denials": recent_denials,
        }

    finally:
        cursor.close()
        conn.close()
