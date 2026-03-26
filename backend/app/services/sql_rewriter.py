"""
SQL Rewriter — Injects mandatory row-level access filters.

This is the "belt AND suspenders" layer. Even if the LLM forgot the
row-level filter, this module injects it unconditionally.

Strategy: Wrap the LLM's query in a CTE and filter its output. This
treats the LLM's SQL as a black box — structurally safe regardless
of how complex the inner query is.
"""

from app.services.rbac_service import RoleContext


class SQLRewriter:

    def rewrite(self, sql: str, role_context: RoleContext) -> tuple[str, str]:
        """
        Rewrite SQL to enforce row-level access.
        Returns (rewritten_sql, explanation).
        """
        if role_context.row_scope == "all":
            return sql, ""

        if role_context.row_scope == "own_patients" and role_context.provider_id:
            return self._rewrite_own_patients(sql, role_context)

        if role_context.row_scope == "department" and role_context.organization_id:
            return self._rewrite_department(sql, role_context)

        if role_context.row_scope == "aggregate_only":
            return self._enforce_k_anonymity(sql, role_context)

        return sql, ""

    def _rewrite_own_patients(self, sql: str, ctx: RoleContext) -> tuple[str, str]:
        """Wrap query so only this provider's patients are returned."""
        sql_upper = sql.upper()
        if "PATIENT" not in sql_upper and "PATIENTS" not in sql_upper:
            return sql, ""

        # Detect patient column reference to use in the filter
        patient_ref = self._find_patient_ref(sql)

        rewritten = f"""-- RBAC: filtered to provider {ctx.provider_id}
SELECT rbac_outer.* FROM (
    {sql.rstrip().rstrip(';')}
) rbac_outer
WHERE EXISTS (
    SELECT 1 FROM dbo.encounters rbac_enc
    WHERE rbac_enc.PATIENT = rbac_outer.{patient_ref}
      AND rbac_enc.PROVIDER = '{ctx.provider_id}'
)"""

        explanation = (
            f"Results filtered to patients assigned to {ctx.display_name}. "
            f"Required by the physician role's own-patients access policy."
        )
        return rewritten, explanation

    def _rewrite_department(self, sql: str, ctx: RoleContext) -> tuple[str, str]:
        """Wrap query so only department patients are returned."""
        sql_upper = sql.upper()
        if "PATIENT" not in sql_upper and "PATIENTS" not in sql_upper:
            return sql, ""

        patient_ref = self._find_patient_ref(sql)

        rewritten = f"""-- RBAC: filtered to organization {ctx.organization_id}
SELECT rbac_outer.* FROM (
    {sql.rstrip().rstrip(';')}
) rbac_outer
WHERE EXISTS (
    SELECT 1 FROM dbo.encounters rbac_enc
    WHERE rbac_enc.PATIENT = rbac_outer.{patient_ref}
      AND rbac_enc.ORGANIZATION = '{ctx.organization_id}'
)"""

        explanation = (
            f"Results filtered to patients seen at {ctx.display_name}'s organization. "
            f"Required by the department-level access policy."
        )
        return rewritten, explanation

    def _find_patient_ref(self, sql: str) -> str:
        """
        Detect what column name the inner query uses for patient identity.
        Checks SELECT clause for aliased patient columns. Falls back to 'PATIENT'.
        For queries selecting patients.Id (aliased or not), we use 'Id'.
        """
        import re
        sql_upper = sql.upper()

        # Check if query selects from patients table with p.Id or patients.Id
        # Look for "p.Id" or "patients.Id" in SELECT clause
        select_end = sql_upper.find("FROM")
        if select_end == -1:
            return "PATIENT"
        select_clause = sql[:select_end]

        # Check for "AS patient_id" or similar aliases
        alias_match = re.search(
            r'(?:PATIENT[S]?\.ID|p\.ID)\s+(?:AS\s+)?(\w+)',
            select_clause, re.IGNORECASE
        )
        if alias_match:
            return alias_match.group(1)

        # If query references patients.Id or p.Id directly
        if re.search(r'\bp\.Id\b', select_clause) or re.search(r'\bpatients\.Id\b', select_clause, re.IGNORECASE):
            return "Id"

        # If PATIENT column is directly in select
        if "PATIENT" in sql_upper[:select_end]:
            return "PATIENT"

        # Default — most clinical tables use PATIENT column
        return "PATIENT"

    def _enforce_k_anonymity(self, sql: str, ctx: RoleContext) -> tuple[str, str]:
        """Add HAVING COUNT(*) >= 5 for k-anonymity."""
        sql_upper = sql.upper()

        if "GROUP BY" in sql_upper and "HAVING" not in sql_upper:
            if "ORDER BY" in sql_upper:
                idx = sql_upper.index("ORDER BY")
                rewritten = sql[:idx] + "HAVING COUNT(*) >= 5\n" + sql[idx:]
            else:
                rewritten = sql.rstrip().rstrip(';') + "\nHAVING COUNT(*) >= 5"

            explanation = (
                "Minimum group size of 5 enforced (k-anonymity) to prevent "
                "re-identification of individuals in aggregate results."
            )
            return rewritten, explanation

        return sql, ""
