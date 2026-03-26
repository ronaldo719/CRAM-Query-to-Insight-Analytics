"""
Role-Based Access Control Service

Loads a user's complete access profile from the database and packages
it into a RoleContext object that flows through the entire query pipeline.

The RoleContext serves three purposes:
  1. Tells the LLM what constraints to apply when generating SQL
  2. Tells the SQL validator what to check for
  3. Tells the SQL rewriter what mandatory WHERE clauses to inject
"""

from dataclasses import dataclass, field
from typing import Optional
import pyodbc
from app.config import settings


@dataclass
class RoleContext:
    """Complete access profile for a single user session."""

    user_id: int
    external_id: str
    display_name: str
    role_name: str

    # Row-level scope
    row_scope: str  # 'own_patients', 'department', 'all', 'aggregate_only'
    provider_id: Optional[str] = None
    organization_id: Optional[str] = None

    # Table-level access
    allowed_tables: list[str] = field(default_factory=list)

    # Column-level deny list: {"patients": ["SSN", "DRIVERS"], ...}
    denied_columns: dict[str, list[str]] = field(default_factory=dict)

    # Other constraints
    can_view_pii: bool = False
    max_row_limit: Optional[int] = None
    sensitivity_tier: str = "standard"

    # Impersonation tracking (for audit logging)
    impersonated_by: Optional[str] = None

    def to_prompt_constraints(self) -> str:
        """
        Generate natural language constraints for the LLM system prompt.
        This is the most critical method — it translates DB permissions
        into instructions the LLM can follow.
        """
        lines = []
        lines.append("## CURRENT USER ACCESS CONSTRAINTS")
        lines.append(f"Generating SQL for: {self.display_name} (role: {self.role_name})")
        lines.append("")

        # Row-level constraints
        if self.row_scope == "own_patients":
            lines.append("### ROW-LEVEL RESTRICTION: OWN PATIENTS ONLY")
            lines.append(f"This user is a physician (provider_id = '{self.provider_id}').")
            lines.append("Every query touching patient data MUST filter to only this provider's patients.")
            lines.append("Add this to EVERY query that references patients or patient-linked tables:")
            lines.append(f"  JOIN encounters e_rbac ON e_rbac.PATIENT = <patient_column>")
            lines.append(f"  AND e_rbac.PROVIDER = '{self.provider_id}'")
            lines.append("If the query already joins encounters, just add: AND e.PROVIDER = '{}'".format(self.provider_id))
            lines.append("")

        elif self.row_scope == "department":
            lines.append("### ROW-LEVEL RESTRICTION: DEPARTMENT PATIENTS ONLY")
            lines.append(f"This user belongs to organization_id = '{self.organization_id}'.")
            lines.append("Every query MUST filter to patients seen at this organization.")
            lines.append(f"  JOIN encounters e_rbac ON e_rbac.PATIENT = <patient_column>")
            lines.append(f"  AND e_rbac.ORGANIZATION = '{self.organization_id}'")
            lines.append("")

        elif self.row_scope == "aggregate_only":
            lines.append("### ROW-LEVEL RESTRICTION: AGGREGATE DATA ONLY")
            lines.append("This user is a researcher and CANNOT view individual patient records.")
            lines.append("EVERY query MUST use GROUP BY with aggregate functions (COUNT, AVG, SUM, etc.).")
            lines.append("NEVER return individual patient rows or use SELECT *.")
            lines.append("Add HAVING COUNT(*) >= 5 for k-anonymity.")
            lines.append("")

        # Table-level constraints
        lines.append("### TABLE ACCESS")
        lines.append(f"ONLY query these tables: {', '.join(self.allowed_tables)}")
        lines.append("If the question requires a table NOT in this list, explain the limitation.")
        lines.append("")

        # Column-level constraints
        if self.denied_columns:
            lines.append("### DENIED COLUMNS — NEVER reference these")
            for table, columns in self.denied_columns.items():
                lines.append(f"  {table}: {', '.join(columns)}")
            lines.append("")

        # PII constraints
        if not self.can_view_pii:
            lines.append("### PII RESTRICTION")
            lines.append("NEVER include: patients.FIRST, patients.LAST, patients.MAIDEN,")
            lines.append("patients.SSN, patients.DRIVERS, patients.PASSPORT, patients.ADDRESS")
            lines.append("")

        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "external_id": self.external_id,
            "display_name": self.display_name,
            "role_name": self.role_name,
            "row_scope": self.row_scope,
            "provider_id": self.provider_id,
            "organization_id": self.organization_id,
            "allowed_tables": self.allowed_tables,
            "denied_columns": self.denied_columns,
            "can_view_pii": self.can_view_pii,
            "sensitivity_tier": self.sensitivity_tier,
            "impersonated_by": self.impersonated_by,
        }


class RBACService:
    """Loads role contexts from the database."""

    def __init__(self, connection_string: str = ""):
        self.connection_string = connection_string or settings.sql_connection_string

    def get_role_context(self, external_id: str, impersonated_by: str = None) -> RoleContext:
        """
        Load complete role context for a user.
        Called once at the start of every query request.
        Raises ValueError if user not found or inactive.
        """
        conn = pyodbc.connect(self.connection_string)
        cursor = conn.cursor()

        try:
            cursor.execute("""
                SELECT
                    u.user_id, u.display_name, u.provider_id, u.organization_id,
                    r.role_name, r.row_scope, r.allowed_tables,
                    r.max_row_limit, r.can_view_pii, r.sensitivity_tier
                FROM dbo.app_users u
                JOIN dbo.app_roles r ON u.role_id = r.role_id
                WHERE u.external_id = ? AND u.is_active = 1
            """, (external_id,))

            row = cursor.fetchone()
            if not row:
                raise ValueError(f"User '{external_id}' not found or inactive")

            # Load column-level deny rules
            cursor.execute("""
                SELECT rca.table_name, rca.column_name
                FROM dbo.app_role_column_access rca
                JOIN dbo.app_roles r ON rca.role_id = r.role_id
                WHERE r.role_name = ? AND rca.access_type = 'deny'
            """, (row.role_name,))

            denied_columns: dict[str, list[str]] = {}
            for col_row in cursor.fetchall():
                table = col_row.table_name
                if table not in denied_columns:
                    denied_columns[table] = []
                denied_columns[table].append(col_row.column_name)

            # Auto-deny PII columns if role can't view PII
            if not row.can_view_pii:
                pii_cols = ["FIRST", "LAST", "MAIDEN", "SSN", "DRIVERS", "PASSPORT", "ADDRESS"]
                if "patients" not in denied_columns:
                    denied_columns["patients"] = []
                for col in pii_cols:
                    if col not in denied_columns["patients"]:
                        denied_columns["patients"].append(col)

            return RoleContext(
                user_id=row.user_id,
                external_id=external_id,
                display_name=row.display_name,
                role_name=row.role_name,
                row_scope=row.row_scope,
                provider_id=str(row.provider_id) if row.provider_id else None,
                organization_id=str(row.organization_id) if row.organization_id else None,
                allowed_tables=[t.strip() for t in row.allowed_tables.split(",")],
                denied_columns=denied_columns,
                can_view_pii=bool(row.can_view_pii),
                max_row_limit=row.max_row_limit,
                sensitivity_tier=row.sensitivity_tier,
                impersonated_by=impersonated_by,
            )
        finally:
            cursor.close()
            conn.close()
