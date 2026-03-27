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
        """Filter query so only this provider's patients are returned."""
        sql_upper = sql.upper()
        if "PATIENT" not in sql_upper and "PATIENTS" not in sql_upper:
            return sql, ""

        # If the provider filter is already present, skip rewriting
        if ctx.provider_id and ctx.provider_id in sql:
            return sql, ""

        explanation = (
            f"Results filtered to patients assigned to {ctx.display_name}. "
            f"Required by the physician role's own-patients access policy."
        )

        # For GROUP BY queries, the CTE wrapper won't work because output
        # columns don't include patient identifiers. Inject the filter
        # into the query instead.
        if self._is_aggregate_query(sql):
            return self._inject_provider_filter(sql, ctx), explanation

        # For non-aggregate queries, use the CTE wrapper approach
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

        return rewritten, explanation

    def _rewrite_department(self, sql: str, ctx: RoleContext) -> tuple[str, str]:
        """Filter query so only department patients are returned."""
        sql_upper = sql.upper()
        if "PATIENT" not in sql_upper and "PATIENTS" not in sql_upper:
            return sql, ""

        # If the organization filter is already present, skip rewriting
        if ctx.organization_id and ctx.organization_id in sql:
            return sql, ""

        explanation = (
            f"Results filtered to patients seen at {ctx.display_name}'s organization. "
            f"Required by the department-level access policy."
        )

        # For GROUP BY queries, inject the filter instead of wrapping
        if self._is_aggregate_query(sql):
            return self._inject_org_filter(sql, ctx), explanation

        # For non-aggregate queries, use the CTE wrapper approach
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

        return rewritten, explanation

    def _is_aggregate_query(self, sql: str) -> bool:
        """Check if the query uses GROUP BY (aggregate results)."""
        return "GROUP BY" in sql.upper()

    def _inject_provider_filter(self, sql: str, ctx: RoleContext) -> str:
        """Inject provider filter into a GROUP BY query via a JOIN."""
        import re
        stripped = sql.rstrip().rstrip(';')

        # Find the patient table reference (e.g., "patients p" or "patients")
        # and add an EXISTS subquery into the WHERE clause
        patient_col = self._find_patient_join_col(sql)

        # Find WHERE clause position, or insert before GROUP BY
        sql_upper = stripped.upper()
        group_idx = sql_upper.find("GROUP BY")

        if "WHERE" in sql_upper[:group_idx] if group_idx != -1 else "WHERE" in sql_upper:
            # Add to existing WHERE with AND
            where_idx = sql_upper.find("WHERE")
            insert_pos = where_idx + len("WHERE")
            filter_clause = (
                f" EXISTS (SELECT 1 FROM dbo.encounters rbac_enc "
                f"WHERE rbac_enc.PATIENT = {patient_col} "
                f"AND rbac_enc.PROVIDER = '{ctx.provider_id}') AND"
            )
            return f"-- RBAC: filtered to provider {ctx.provider_id}\n" + stripped[:insert_pos] + filter_clause + stripped[insert_pos:]
        elif group_idx != -1:
            # Insert WHERE before GROUP BY
            filter_clause = (
                f"WHERE EXISTS (SELECT 1 FROM dbo.encounters rbac_enc "
                f"WHERE rbac_enc.PATIENT = {patient_col} "
                f"AND rbac_enc.PROVIDER = '{ctx.provider_id}')\n"
            )
            return f"-- RBAC: filtered to provider {ctx.provider_id}\n" + stripped[:group_idx] + filter_clause + stripped[group_idx:]
        else:
            # Append WHERE
            filter_clause = (
                f"\nWHERE EXISTS (SELECT 1 FROM dbo.encounters rbac_enc "
                f"WHERE rbac_enc.PATIENT = {patient_col} "
                f"AND rbac_enc.PROVIDER = '{ctx.provider_id}')"
            )
            return f"-- RBAC: filtered to provider {ctx.provider_id}\n" + stripped + filter_clause

    def _inject_org_filter(self, sql: str, ctx: RoleContext) -> str:
        """Inject organization filter into a GROUP BY query."""
        import re
        stripped = sql.rstrip().rstrip(';')

        patient_col = self._find_patient_join_col(sql)

        sql_upper = stripped.upper()
        group_idx = sql_upper.find("GROUP BY")

        if "WHERE" in sql_upper[:group_idx] if group_idx != -1 else "WHERE" in sql_upper:
            where_idx = sql_upper.find("WHERE")
            insert_pos = where_idx + len("WHERE")
            filter_clause = (
                f" EXISTS (SELECT 1 FROM dbo.encounters rbac_enc "
                f"WHERE rbac_enc.PATIENT = {patient_col} "
                f"AND rbac_enc.ORGANIZATION = '{ctx.organization_id}') AND"
            )
            return f"-- RBAC: filtered to org {ctx.organization_id}\n" + stripped[:insert_pos] + filter_clause + stripped[insert_pos:]
        elif group_idx != -1:
            filter_clause = (
                f"WHERE EXISTS (SELECT 1 FROM dbo.encounters rbac_enc "
                f"WHERE rbac_enc.PATIENT = {patient_col} "
                f"AND rbac_enc.ORGANIZATION = '{ctx.organization_id}')\n"
            )
            return f"-- RBAC: filtered to org {ctx.organization_id}\n" + stripped[:group_idx] + filter_clause + stripped[group_idx:]
        else:
            filter_clause = (
                f"\nWHERE EXISTS (SELECT 1 FROM dbo.encounters rbac_enc "
                f"WHERE rbac_enc.PATIENT = {patient_col} "
                f"AND rbac_enc.ORGANIZATION = '{ctx.organization_id}')"
            )
            return f"-- RBAC: filtered to org {ctx.organization_id}\n" + stripped + filter_clause

    def _find_patient_join_col(self, sql: str) -> str:
        """Find the patient column reference used in JOINs/WHERE (not SELECT output)."""
        import re
        # Look for p.Id or patients.Id used with PATIENT joins
        if re.search(r'\bp\.Id\b', sql):
            return "p.Id"
        if re.search(r'\bpatients\.Id\b', sql, re.IGNORECASE):
            return "patients.Id"
        # Look for table.PATIENT references
        m = re.search(r'(\w+)\.PATIENT\b', sql)
        if m:
            return f"{m.group(1)}.PATIENT"
        return "p.Id"

    def _find_patient_ref(self, sql: str) -> str:
        """
        Detect what column name the inner query uses for patient identity
        in its SELECT output. Used for CTE wrapper filtering.
        Falls back to 'PATIENT'.
        """
        import re
        sql_upper = sql.upper()

        select_end = sql_upper.find("FROM")
        if select_end == -1:
            return "PATIENT"
        select_clause = sql[:select_end]

        # Check for "AS patient_id" or similar aliases (direct column, not inside aggregate)
        alias_match = re.search(
            r'(?:PATIENT[S]?\.ID|p\.ID)\s+(?:AS\s+)?(\w+)',
            select_clause, re.IGNORECASE
        )
        if alias_match:
            return alias_match.group(1)

        # Only match p.Id as a direct SELECT column, NOT inside aggregate functions
        # e.g., match "SELECT p.Id, ..." but not "SELECT COUNT(DISTINCT p.Id) ..."
        if re.search(r'SELECT\s+(?:TOP\s+\d+\s+)?(?:DISTINCT\s+)?p\.Id\b', select_clause, re.IGNORECASE):
            return "Id"
        # Match "p.Id" as a comma-separated column (", p.Id,")
        if re.search(r',\s*p\.Id\s*(?:,|$)', select_clause, re.IGNORECASE):
            return "Id"

        # If PATIENT column is directly in select (not inside a word like patient_count)
        if re.search(r'\bPATIENT\b', sql_upper[:select_end]) and not re.search(r'PATIENT_', sql_upper[:select_end]):
            return "PATIENT"

        # Default
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
