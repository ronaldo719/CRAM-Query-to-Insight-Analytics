"""
Conversation Manager -- Session history and proactive suggestions.

Manages two key features:
  1. Conversation memory: stores the last N query/result pairs per session
     so follow-up questions like "now break that down by age group" resolve
     correctly against the prior query context.

  2. Proactive suggestions: after each answer, generates 3 context-aware
     follow-up questions the user might want to ask next. These appear as
     clickable chips in the UI, transforming the tool from reactive to
     proactive -- one of the highest-impact innovation features.

Sessions are keyed by external_id (the logged-in user or impersonated user).
History is stored in-memory (dict) since it only needs to survive within a
single server process for the hackathon. In production, you'd use Redis.
"""

from dataclasses import dataclass
from typing import Optional
from collections import defaultdict

from app.config import get_openai_client, settings
from app.services.rbac_service import RoleContext


@dataclass
class ConversationEntry:
    question: str
    sql: str
    answer: str
    role_name: str
    row_count: int


class ConversationManager:

    MAX_HISTORY = 5  # Keep last 5 exchanges per session

    def __init__(self):
        # In-memory history keyed by user external_id
        # In production: use Redis with TTL
        self._history: dict[str, list[ConversationEntry]] = defaultdict(list)

    def add_entry(
        self,
        user_id: str,
        question: str,
        sql: str,
        answer: str,
        role_name: str,
        row_count: int,
    ):
        """Store a completed query/response pair in the session history."""
        entry = ConversationEntry(
            question=question,
            sql=sql,
            answer=answer,
            role_name=role_name,
            row_count=row_count,
        )
        history = self._history[user_id]
        history.append(entry)
        # Trim to max size
        if len(history) > self.MAX_HISTORY:
            self._history[user_id] = history[-self.MAX_HISTORY:]

    def get_history(self, user_id: str) -> list[dict]:
        """
        Return conversation history formatted for the LLM prompt.
        Each entry contains the question and the SQL that was generated,
        so the LLM can understand context for follow-up questions.
        """
        entries = self._history.get(user_id, [])
        return [
            {"question": e.question, "sql": e.sql}
            for e in entries
        ]

    def get_last_entry(self, user_id: str) -> Optional[ConversationEntry]:
        """Get the most recent conversation entry for suggestion generation."""
        entries = self._history.get(user_id, [])
        return entries[-1] if entries else None

    def clear(self, user_id: str):
        """Clear conversation history for a user (e.g., on role switch)."""
        self._history.pop(user_id, None)

    def generate_suggestions(
        self,
        user_id: str,
        role_context: RoleContext,
    ) -> list[str]:
        """
        Generate 3 proactive follow-up questions based on the conversation
        history and the user's role.

        If there's no history yet, returns role-appropriate starter questions.
        If there is history, generates contextual follow-ups based on the
        last query and results.
        """
        last = self.get_last_entry(user_id)

        if not last:
            return self._starter_suggestions(role_context)

        return self._contextual_suggestions(last, role_context)

    def _starter_suggestions(self, role_ctx: RoleContext) -> list[str]:
        """Role-specific starter questions for new sessions."""
        starters = {
            "physician": [
                "Show me my patients with active chronic conditions",
                "What medications have I prescribed most frequently?",
                "How many encounters did I have in the last year?",
            ],
            "nurse": [
                "Which department patients have overdue immunizations?",
                "Show me recent vital sign readings for department patients",
                "List active care plans in my department",
            ],
            "billing": [
                "What are the total outstanding claims by payer?",
                "Show me the highest-cost encounters this year",
                "Compare covered vs uncovered amounts across payers",
            ],
            "researcher": [
                "What are the top 10 conditions by patient count?",
                "Show me the age distribution of the patient population",
                "Compare average healthcare costs by gender",
            ],
            "admin": [
                "Give me a population health overview",
                "What are the top 10 conditions by prevalence?",
                "Show me encounter volume by type",
            ],
        }
        return starters.get(role_ctx.role_name, starters["admin"])

    def _contextual_suggestions(
        self, last: ConversationEntry, role_ctx: RoleContext
    ) -> list[str]:
        """Generate follow-up suggestions based on the last query."""
        try:
            client = get_openai_client()
            response = client.chat.completions.create(
                model=settings.model_name,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a healthcare analytics assistant. Given the user's "
                            "last question and the SQL that was generated, suggest exactly "
                            "3 natural follow-up questions they might want to ask next.\n\n"
                            "Rules:\n"
                            "- Questions must be answerable from the same database\n"
                            f"- User role is {role_ctx.role_name} with {role_ctx.row_scope} scope\n"
                            "- Suggest deeper analysis, different breakdowns, or related topics\n"
                            "- Keep questions concise (under 15 words each)\n"
                            "- Return ONLY 3 questions, one per line, no numbering or bullets"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Last question: {last.question}\n"
                            f"SQL generated: {last.sql}\n"
                            f"Rows returned: {last.row_count}\n"
                            f"Answer summary: {last.answer[:200]}"
                        ),
                    },
                ],
                temperature=0.7,  # Slight creativity for diverse suggestions
                max_tokens=150,
            )

            text = response.choices[0].message.content.strip()
            suggestions = [
                line.strip().lstrip("0123456789.-) ")
                for line in text.split("\n")
                if line.strip() and len(line.strip()) > 5
            ]
            return suggestions[:3]

        except Exception:
            # Fallback to generic suggestions on LLM failure
            return [
                "Break that down by age group",
                "Show me the trend over time",
                "Compare across different patient demographics",
            ]
