"""
Query Router — The main API endpoint for natural language queries.

This is the entry point for all user questions. On Day 1, the endpoint is
stubbed to return a placeholder response so the frontend team can build
against a real API contract. On Day 2, we'll wire in the full pipeline:
Content Safety → LLM SQL generation → SQL validation → RBAC rewriting →
execution → result explanation.

The key design decision here is the X-User-Id header. In production this
would come from an Azure Entra ID token (the authenticated user's identity).
For the hackathon demo, we pass it as a plain header so judges can switch
roles instantly via a dropdown in the UI. The backend uses this to load
the user's RoleContext, which flows through every step of the pipeline.
"""

from fastapi import APIRouter, Header
from pydantic import BaseModel
from typing import Optional
import time

from app.config import settings, get_openai_client

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
# These define the API contract between frontend and backend.
# The frontend team can start building against these shapes immediately
# even while the backend logic is still stubbed.
# ---------------------------------------------------------------------------

class QueryRequest(BaseModel):
    question: str
    conversation_history: Optional[list[dict]] = None


class QueryResponse(BaseModel):
    # The answer in plain business language
    answer: str
    # Raw data for auto-visualization (Day 3)
    visualization: Optional[dict] = None

    # Transparency panel — show the user what happened (Responsible AI)
    generated_sql: str
    executed_sql: str
    was_modified: bool
    modification_explanation: str
    tables_accessed: list[str]

    # Role context — shows the user what access level produced these results
    role_name: str
    access_scope: str
    warnings: list[str]

    # Metadata
    row_count: int
    execution_time_ms: int
    confidence: str  # "high", "medium", "low", "denied"


class RolesResponse(BaseModel):
    """Returns available demo roles for the frontend role switcher."""
    roles: list[dict]


# ---------------------------------------------------------------------------
# GET /api/query/roles — returns the list of demo roles for the UI dropdown
# ---------------------------------------------------------------------------

@router.get("/roles", response_model=RolesResponse)
async def get_roles():
    """
    Returns the list of available demo roles. The frontend calls this
    on page load to populate the role switcher dropdown. Each role has
    an id (sent as X-User-Id header), a display label, and a description
    explaining what access that role has.
    """
    return RolesResponse(
        roles=[
            {
                "id": "demo_doctor",
                "label": "Dr. Sarah Chen",
                "icon": "stethoscope",
                "description": "Physician — sees own patients, full clinical data",
            },
            {
                "id": "demo_nurse",
                "label": "James Rodriguez, RN",
                "icon": "heart-pulse",
                "description": "Nurse — department patients, clinical data, no billing",
            },
            {
                "id": "demo_billing",
                "label": "Maria Thompson",
                "icon": "receipt",
                "description": "Billing — all patients, financial data only, no clinical",
            },
            {
                "id": "demo_researcher",
                "label": "Dr. Alex Kumar",
                "icon": "microscope",
                "description": "Researcher — aggregate data only, no PII, no individual records",
            },
            {
                "id": "demo_admin",
                "label": "System Admin",
                "icon": "shield",
                "description": "Admin — full access to all data",
            },
        ]
    )


# ---------------------------------------------------------------------------
# POST /api/query/ask — the main query endpoint
# ---------------------------------------------------------------------------

@router.post("/ask", response_model=QueryResponse)
async def ask_question(
    request: QueryRequest,
    x_user_id: str = Header(default="demo_admin", alias="X-User-Id"),
):
    """
    Accept a natural language question and return an AI-generated answer.

    Day 1: Returns a stubbed response that proves the API contract works.
    Day 2: Full pipeline — RBAC lookup → Content Safety → LLM SQL generation
            → sqlglot validation → SQL rewriting → execution → explanation.

    The X-User-Id header determines which demo role is active. The frontend
    sends this from its role switcher dropdown. Try switching between
    'demo_doctor', 'demo_billing', and 'demo_researcher' to see how the
    same question produces different access levels.
    """
    start_time = time.time()

    # ── Day 2: These will be replaced with real implementations ───
    # For now, we call the LLM with a simple prompt to verify the
    # OpenAI connection works end-to-end through the API.

    client = get_openai_client()
    model = settings.model_name

    try:
        llm_response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a healthcare SQL analytics expert. "
                        "Generate a T-SQL SELECT query for the question. "
                        "The database has tables: patients, encounters, conditions, "
                        "medications, observations, procedures, immunizations, "
                        "allergies, careplans, claims, claims_transactions, "
                        "imaging_studies, devices, supplies, payers, "
                        "payer_transitions, organizations, providers."
                    ),
                },
                {"role": "user", "content": request.question},
            ],
            temperature=0,
            max_tokens=500,
        )
        generated_sql = llm_response.choices[0].message.content.strip()
    except Exception as e:
        generated_sql = f"-- LLM Error: {str(e)}"

    execution_time_ms = int((time.time() - start_time) * 1000)

    # ── Stubbed response showing the API contract shape ───────────
    # The frontend can build against this structure right now.
    # Day 2 will populate every field with real data.
    return QueryResponse(
        answer=(
            f"[Day 1 Stub] Received question as **{x_user_id}**: "
            f"\"{request.question}\"\n\n"
            f"Generated SQL:\n```sql\n{generated_sql}\n```\n\n"
            f"Full pipeline (RBAC filtering, SQL execution, result explanation) "
            f"will be wired on Day 2."
        ),
        visualization=None,
        generated_sql=generated_sql,
        executed_sql="-- Not yet executed (Day 2)",
        was_modified=False,
        modification_explanation="",
        tables_accessed=[],
        role_name=x_user_id.replace("demo_", ""),
        access_scope="stub",
        warnings=[],
        row_count=0,
        execution_time_ms=execution_time_ms,
        confidence="stub",
    )
