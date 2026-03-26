"""
SQL Validator with Role-Based Access Enforcement

Two jobs:
  1. SAFETY — prevents destructive SQL (DROP, DELETE, etc.)
  2. RBAC — ensures SQL respects the user's role constraints

Uses sqlglot to parse SQL into an AST, then walks the tree to extract
every table and column reference and checks them against the RoleContext.
"""

import sqlglot
from sqlglot import exp
from dataclasses import dataclass, field
from app.services.rbac_service import RoleContext


@dataclass
class ValidationResult:
    is_valid: bool
    sql: str
    violations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    tables_accessed: list[str] = field(default_factory=list)
    columns_accessed: dict[str, list[str]] = field(default_factory=dict)
    was_rewritten: bool = False


class SQLValidator:

    FORBIDDEN_TYPES = {
        exp.Insert, exp.Update, exp.Delete, exp.Drop,
        exp.Create, exp.Alter, exp.Grant, exp.Command,
    }

    FORBIDDEN_TABLE_PATTERNS = [
        "sys.", "information_schema.", "app_users", "app_roles",
        "app_role_column_access", "app_query_audit_log",
    ]

    def validate(self, sql: str, role_context: RoleContext) -> ValidationResult:
        result = ValidationResult(is_valid=True, sql=sql)

        # —— Layer 1: Parse ——————————————————————————————————
        try:
            parsed = sqlglot.parse(sql, dialect="tsql")
            if not parsed or not parsed[0]:
                result.is_valid = False
                result.violations.append("Could not parse the generated SQL.")
                return result
        except Exception as e:
            result.is_valid = False
            result.violations.append(f"SQL syntax error: {str(e)[:200]}")
            return result

        statement = parsed[0]

        # —— Layer 2: No mutations ———————————————————————————
        for node in statement.walk():
            for ft in self.FORBIDDEN_TYPES:
                if isinstance(node, ft):
                    result.is_valid = False
                    result.violations.append(
                        f"Statement type '{type(node).__name__}' is not allowed. "
                        f"Only SELECT queries are permitted."
                    )
                    return result

        # —— Layer 3: Extract tables ———————————————————————————
        tables = set()
        for table_node in statement.find_all(exp.Table):
            table_name = table_node.name.lower()
            for pattern in self.FORBIDDEN_TABLE_PATTERNS:
                if pattern.lower() in table_name:
                    result.is_valid = False
                    result.violations.append(
                        f"Access to system table '{table_name}' is not permitted."
                    )
                    return result
            tables.add(table_name)

        result.tables_accessed = sorted(tables)

        # —— Layer 4: Table-level access ———————————————————————
        allowed = {t.lower() for t in role_context.allowed_tables}
        for table in tables:
            if table not in allowed:
                result.is_valid = False
                result.violations.append(
                    f"Your role ({role_context.role_name}) does not have access "
                    f"to the '{table}' table. Allowed: {', '.join(sorted(allowed))}"
                )

        if not result.is_valid:
            return result

        # —— Layer 5: Column-level access ——————————————————————
        columns_by_table = self._extract_columns(statement, tables)
        result.columns_accessed = columns_by_table

        for table, columns in columns_by_table.items():
            denied = [d.lower() for d in role_context.denied_columns.get(table, [])]
            for col in columns:
                if col.lower() in denied:
                    result.is_valid = False
                    result.violations.append(
                        f"Your role ({role_context.role_name}) cannot access "
                        f"column '{col}' in table '{table}'."
                    )

        if not result.is_valid:
            return result

        # —— Layer 6: Aggregate-only enforcement ———————————————
        if role_context.row_scope == "aggregate_only":
            has_group_by = statement.find(exp.Group) is not None
            has_agg = any(
                isinstance(node, (exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max))
                for node in statement.walk()
            )
            if not has_group_by and not has_agg:
                result.is_valid = False
                result.violations.append(
                    f"Your role ({role_context.role_name}) requires aggregated queries "
                    f"(COUNT, SUM, AVG, etc. with GROUP BY). Individual records are not allowed."
                )
                return result

        # —— Layer 7: Inject TOP if missing ————————————————————
        sql_upper = sql.strip().upper()
        has_top = "TOP" in sql_upper[:60]
        if not has_top and role_context.row_scope != "aggregate_only":
            limit = role_context.max_row_limit or 500
            sql = sql.strip()
            if sql_upper.startswith("SELECT DISTINCT"):
                sql = sql[:15] + f" TOP {limit}" + sql[15:]
                result.sql = sql
                result.was_rewritten = True
                result.warnings.append(f"Added TOP {limit} row limit for safety.")
            elif sql_upper.startswith("SELECT"):
                sql = sql[:6] + f" TOP {limit}" + sql[6:]
                result.sql = sql
                result.was_rewritten = True
                result.warnings.append(f"Added TOP {limit} row limit for safety.")

        # —— Layer 8: Row scope presence check —————————————————
        if role_context.row_scope == "own_patients" and role_context.provider_id:
            if role_context.provider_id not in sql:
                result.warnings.append(
                    "Provider filter was not found in the query — "
                    "it will be injected automatically by the access control layer."
                )
        elif role_context.row_scope == "department" and role_context.organization_id:
            if role_context.organization_id not in sql:
                result.warnings.append(
                    "Organization filter was not found in the query — "
                    "it will be injected automatically by the access control layer."
                )

        return result

    def _extract_columns(self, statement, known_tables):
        """Extract column references grouped by table."""
        columns_by_table: dict[str, list[str]] = {}

        # Build alias map
        alias_map = {}
        for table_node in statement.find_all(exp.Table):
            name = table_node.name.lower()
            if table_node.alias:
                alias_map[table_node.alias.lower()] = name
            alias_map[name] = name

        for col_node in statement.find_all(exp.Column):
            col_name = col_node.name
            table_ref = col_node.table

            if table_ref:
                resolved = alias_map.get(table_ref.lower(), table_ref.lower())
                columns_by_table.setdefault(resolved, []).append(col_name)
            else:
                # Ambiguous — check against all tables conservatively
                for table in known_tables:
                    columns_by_table.setdefault(table, []).append(col_name)

        return columns_by_table
