"""
Query Router — The main API endpoint for natural language queries.

Now fully wired to the Day 2 pipeline:
  JWT auth → RBAC context → Content Safety → SQL generation →
  sqlglot validation → RBAC rewriting → execution → explanation → audit

Admin impersonation is handled transparently by the auth dependency.
The `user` dict contains the effective user's identity — either the
logged-in user or the impersonated user if the admin set X-Impersonate.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from app.dependencies.auth import get_current_user
from app.services.query_engine import QueryEngine

router = APIRouter()

# Single QueryEngine instance shared across all requests
engine = QueryEngine()


# —— Request / Response models ———————————————————————————————

class QueryRequest(BaseModel):
    question: str
    conversation_history: Optional[list[dict]] = None


class QueryResponse(BaseModel):
    answer: str
    visualization: Optional[dict] = None

    generated_sql: str
    executed_sql: str
    was_modified: bool
    modification_explanation: str
    tables_accessed: list[str]

    role_name: str
    access_scope: str
    warnings: list[str]

    row_count: int
    execution_time_ms: int
    confidence: str

    # Data for frontend table rendering
    result_columns: list[str] = []
    result_rows: list[list] = []


# —— POST /api/query/ask ————————————————————————————————————

@router.post("/ask", response_model=QueryResponse)
async def ask_question(
    request: QueryRequest,
    user: dict = Depends(get_current_user),
):
    """
    Accept a natural language question and run the full NL-to-SQL pipeline.

    The user's identity comes from the JWT token (or admin impersonation).
    Their role determines what data they can access — the same question
    produces different results depending on who's asking.
    """
    # The effective user is either the actual user or the impersonated user
    effective_user_id = user.get("external_id")
    impersonated_by = user.get("impersonated_by")

    result = await engine.execute_query(
        question=request.question,
        user_external_id=effective_user_id,
        impersonated_by=impersonated_by,
        conversation_history=request.conversation_history,
    )

    return QueryResponse(
        answer=result.answer,
        visualization=result.visualization,
        generated_sql=result.generated_sql,
        executed_sql=result.executed_sql,
        was_modified=result.was_modified,
        modification_explanation=result.modification_explanation,
        tables_accessed=result.tables_accessed,
        role_name=result.role_name,
        access_scope=result.access_scope,
        warnings=result.warnings,
        row_count=result.row_count,
        execution_time_ms=result.execution_time_ms,
        confidence=result.confidence,
        result_columns=result.result_columns,
        result_rows=result.raw_results[:100],  # Cap at 100 rows for frontend
    )


# —— GET /api/query/roles ———————————————————————————————————
# Kept for backwards compatibility — the frontend's impersonation
# dropdown now uses /api/auth/users instead, but this endpoint
# is still useful for unauthenticated role discovery.

@router.get("/roles")
async def get_roles():
    return {
        "roles": [
            {"id": "demo_doctor", "label": "Dr. Sarah Chen", "icon": "stethoscope",
             "description": "Physician — sees own patients, full clinical data"},
            {"id": "demo_nurse", "label": "James Rodriguez, RN", "icon": "heart-pulse",
             "description": "Nurse — department patients, clinical data, no billing"},
            {"id": "demo_billing", "label": "Maria Thompson", "icon": "receipt",
             "description": "Billing — all patients, financial data only, no clinical"},
            {"id": "demo_researcher", "label": "Dr. Alex Kumar", "icon": "microscope",
             "description": "Researcher — aggregate data only, no PII"},
            {"id": "demo_admin", "label": "System Admin", "icon": "shield",
             "description": "Admin — full access to all data"},
        ]
    }
