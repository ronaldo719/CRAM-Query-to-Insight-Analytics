"""
Sensitivity Classifier -- Green / Amber / Red query classification.

Evaluates each natural language query BEFORE SQL generation to determine
its sensitivity level based on what data it's trying to access:

  GREEN  -- Safe to auto-execute. Simple aggregations, general counts,
            non-sensitive clinical queries.
            Example: "How many patients by gender?"

  AMBER  -- Execute with advisory notice. Demographic breakdowns correlated
            with health outcomes, cost analysis by population group.
            Example: "Diabetes prevalence by race and income"

  RED    -- Requires explicit approval. Individual patient records for
            stigmatized conditions, re-identification risk queries,
            demographic profiling patterns.
            Example: "List patients with HIV and their addresses"

The classification is shown to the user as a colored badge in the UI
and logged in the audit trail. RED queries are blocked with a message
explaining why approval is needed.

For the hackathon demo, RED queries are soft-blocked (shown a warning
but allowed to proceed after acknowledgment). In production, RED
queries would route to an approval workflow via Azure Logic Apps.
"""

from dataclasses import dataclass
from app.config import get_openai_client, settings
from app.services.rbac_service import RoleContext


@dataclass
class SensitivityResult:
    level: str          # "green", "amber", "red"
    reason: str         # Human-readable explanation
    should_block: bool  # Whether to block execution
    advisory: str       # Message shown to the user


# -- Rule-based pre-checks (fast, no LLM call needed) ----------
# These patterns catch obvious cases without burning an API call.

STIGMATIZED_CONDITIONS = [
    "hiv", "aids", "std", "sexually transmitted", "herpes",
    "hepatitis", "substance abuse", "drug abuse", "addiction",
    "alcohol", "mental health", "psychiatric", "suicide",
    "self-harm", "abortion", "miscarriage",
]

RED_PATTERNS = [
    # Individual patient + stigmatized condition
    ("individual", "stigmatized"),
    # PII access patterns
    ("ssn", ""), ("social security", ""), ("passport", ""),
    ("drivers license", ""), ("driver's license", ""),
]

AMBER_KEYWORDS = [
    # Demographic correlation patterns
    "by race", "by ethnicity", "racial", "ethnic",
    "by income", "by gender and", "demographic",
    "disparity", "disparities", "inequality",
    # Re-identification risk
    "individual", "specific patient", "patient name",
    "list all patients", "show me patients",
]


class SensitivityClassifier:

    def classify(
        self, question: str, role_context: RoleContext
    ) -> SensitivityResult:
        """
        Classify a query's sensitivity level.
        Uses rule-based checks first (fast), falls back to LLM for
        ambiguous cases.
        """
        q_lower = question.lower()

        # -- Rule-based RED checks ----------------------------
        # Check for stigmatized condition + individual access pattern
        has_stigmatized = any(s in q_lower for s in STIGMATIZED_CONDITIONS)
        has_individual = any(
            w in q_lower for w in ["individual", "specific", "list patients",
                                    "show me patient", "patient name"]
        )

        if has_stigmatized and has_individual:
            return SensitivityResult(
                level="red",
                reason=(
                    "Query references sensitive health conditions combined with "
                    "individual patient identification patterns."
                ),
                should_block=True,
                advisory=(
                    "This query involves sensitive health data at the individual level. "
                    "In a production system, this would require approval from a "
                    "privacy officer. For this demo, the query has been blocked."
                ),
            )

        # Direct PII access attempts
        pii_terms = ["ssn", "social security", "passport", "driver"]
        if any(term in q_lower for term in pii_terms):
            if not role_context.can_view_pii:
                return SensitivityResult(
                    level="red",
                    reason="Query requests personally identifiable information.",
                    should_block=True,
                    advisory=(
                        "Your role does not have access to personally identifiable "
                        "information (PII). This restriction protects patient privacy."
                    ),
                )

        # -- Rule-based AMBER checks --------------------------
        amber_matches = [kw for kw in AMBER_KEYWORDS if kw in q_lower]
        if amber_matches:
            return SensitivityResult(
                level="amber",
                reason=f"Query involves sensitive patterns: {', '.join(amber_matches[:3])}",
                should_block=False,
                advisory=(
                    "This query touches on demographic or population-level "
                    "sensitive data. Results are provided but should be "
                    "interpreted with appropriate context and care."
                ),
            )

        # -- Rule-based GREEN for clearly safe patterns --------
        safe_patterns = [
            "how many", "count", "total", "average", "top",
            "most common", "summary", "overview",
        ]
        if any(p in q_lower for p in safe_patterns) and not has_stigmatized:
            return SensitivityResult(
                level="green",
                reason="Standard analytical query.",
                should_block=False,
                advisory="",
            )

        # -- LLM classification for ambiguous cases ------------
        return self._llm_classify(question, role_context)

    def _llm_classify(
        self, question: str, role_context: RoleContext
    ) -> SensitivityResult:
        """Use the LLM to classify ambiguous queries."""
        try:
            client = get_openai_client()
            response = client.chat.completions.create(
                model=settings.model_name,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a healthcare data privacy classifier. "
                            "Classify the sensitivity of a data query as exactly one of: "
                            "GREEN, AMBER, or RED.\n\n"
                            "GREEN: General analytics, aggregations, non-sensitive lookups.\n"
                            "AMBER: Demographic correlations with health, population disparities, "
                            "cost analysis by demographic group.\n"
                            "RED: Individual patient records for stigmatized conditions, "
                            "re-identification risk, PII access.\n\n"
                            "Respond with ONLY one line in this format:\n"
                            "LEVEL|reason\n"
                            "Example: GREEN|Standard count query with no sensitive dimensions"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Query: {question}\n"
                            f"User role: {role_context.role_name} "
                            f"(scope: {role_context.row_scope})"
                        ),
                    },
                ],
                temperature=0,
                max_tokens=100,
            )

            text = response.choices[0].message.content.strip()
            parts = text.split("|", 1)
            level = parts[0].strip().lower()
            reason = parts[1].strip() if len(parts) > 1 else "Classified by AI"

            if level not in ("green", "amber", "red"):
                level = "amber"  # Default to caution on parse failure

            return SensitivityResult(
                level=level,
                reason=reason,
                should_block=(level == "red"),
                advisory=self._advisory_for_level(level, reason),
            )

        except Exception:
            # On LLM failure, default to amber (cautious but not blocking)
            return SensitivityResult(
                level="amber",
                reason="Classification unavailable -- defaulting to amber.",
                should_block=False,
                advisory="Sensitivity classification was unavailable. Proceeding with caution.",
            )

    def _advisory_for_level(self, level: str, reason: str) -> str:
        if level == "green":
            return ""
        elif level == "amber":
            return (
                f"Advisory: {reason}. Results are provided but should be "
                f"interpreted with appropriate context."
            )
        else:
            return (
                f"This query has been flagged as highly sensitive: {reason}. "
                f"In production, approval from a privacy officer would be required."
            )
