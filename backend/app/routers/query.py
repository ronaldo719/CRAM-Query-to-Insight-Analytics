"""
Query Router -- Day 3: Full pipeline with conversation + suggestions.Day 5: Added cache stats endpoint and from_cache field.

New response fields:
  + sensitivity_level / sensitivity_advisory -- green/amber/red badge
  + bias_alert -- demographic disparity warning
  + suggestions -- 3 proactive follow-up questions
  + result_columns / result_rows -- data for frontend table rendering

New endpoints:
  + POST /api/query/clear-history -- reset conversation memory (on role switch)
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from app.dependencies.auth import get_current_user, require_admin
from app.services.query_engine import QueryEngine

router = APIRouter()
engine = QueryEngine()


class QueryRequest(BaseModel):
    question: str


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

    # Day 3: Responsible AI
    sensitivity_level: str = "green"
    sensitivity_advisory: str = ""
    bias_alert: Optional[str] = None

    # Day 3: Innovation
    suggestions: list[str] = []

    # Data for frontend table rendering
    result_columns: list[str] = []
    result_rows: list[list] = []
    from_cache: bool = False


@router.post("/ask", response_model=QueryResponse)
async def ask_question(
    request: QueryRequest,
    user: dict = Depends(get_current_user),
):
    """
    Full NL-to-SQL pipeline with RBAC, Content Safety, sensitivity
    classification, bias detection, and proactive suggestions.
    """
    effective_user_id = user.get("external_id")
    impersonated_by = user.get("impersonated_by")

    result = await engine.execute_query(
        question=request.question,
        user_external_id=effective_user_id,
        impersonated_by=impersonated_by,
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
        sensitivity_level=result.sensitivity_level,
        sensitivity_advisory=result.sensitivity_advisory,
        bias_alert=result.bias_alert,
        suggestions=result.suggestions,
        result_columns=result.result_columns,
        result_rows=result.raw_results[:100],
        from_cache=result.from_cache,
    )


@router.post("/clear-history")
async def clear_conversation_history(
    user: dict = Depends(get_current_user),
):
    """
    Clear conversation memory for the current user.
    Called by the frontend when the admin switches impersonation targets,
    so follow-up questions don't leak context between roles.
    """
    effective_user_id = user.get("external_id")
    engine.clear_conversation(effective_user_id)
    return {"message": "Conversation history cleared"}


@router.get("/cache-stats")
async def get_cache_stats(admin: dict = Depends(require_admin)):
    """Cache performance statistics. Admin-only."""
    return engine.get_cache_stats()


@router.get("/roles")
async def get_roles():
    return {
        "roles": [
            {"id": "demo_doctor", "label": "Dr. Sarah Chen", "icon": "stethoscope",
             "description": "Physician -- sees own patients, full clinical data"},
            {"id": "demo_nurse", "label": "James Rodriguez, RN", "icon": "heart-pulse",
             "description": "Nurse -- department patients, clinical data, no billing"},
            {"id": "demo_billing", "label": "Maria Thompson", "icon": "receipt",
             "description": "Billing -- all patients, financial data only"},
            {"id": "demo_researcher", "label": "Dr. Alex Kumar", "icon": "microscope",
             "description": "Researcher -- aggregate data only, no PII"},
            {"id": "demo_admin", "label": "System Admin", "icon": "shield",
             "description": "Admin -- full access to all data"},
        ]
    }
