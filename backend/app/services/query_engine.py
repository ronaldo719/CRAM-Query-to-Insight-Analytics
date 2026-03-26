"""
Query Engine — Orchestrates the complete NL-to-SQL pipeline.

This is the brain of the application. A single call to execute_query()
runs the full pipeline:

  1. Load RoleContext from database (via RBACService)
  2. Screen input through Content Safety
  3. Generate SQL with role-aware system prompt (via Azure OpenAI)
  4. Validate SQL against RBAC rules (via SQLValidator)
  5. Rewrite SQL with mandatory access filters (via SQLRewriter)
  6. Execute SQL against read-only database connection
  7. Generate natural language explanation (via Azure OpenAI)
  8. Log everything to the audit table

If SQL generation fails validation, the engine retries up to 3 times
with the error message fed back to the LLM (self-correction loop).
"""

import time
import json
import pyodbc
from typing import Optional
from dataclasses import dataclass, field

from app.config import settings, get_openai_client
from app.services.rbac_service import RBACService, RoleContext
from app.services.sql_validator import SQLValidator, ValidationResult
from app.services.sql_rewriter import SQLRewriter
from app.services.content_safety_service import ContentSafetyService


@dataclass
class QueryResult:
    """Complete result of a query pipeline execution."""
    answer: str = ""
    visualization: Optional[dict] = None

    generated_sql: str = ""
    executed_sql: str = ""
    was_modified: bool = False
    modification_explanation: str = ""
    tables_accessed: list[str] = field(default_factory=list)

    role_name: str = ""
    access_scope: str = ""
    warnings: list[str] = field(default_factory=list)

    row_count: int = 0
    execution_time_ms: int = 0
    confidence: str = "high"

    # Internal tracking
    was_denied: bool = False
    denial_reason: str = ""
    content_safety_scores: dict = field(default_factory=dict)
    retry_count: int = 0
    raw_results: list = field(default_factory=list)
    result_columns: list[str] = field(default_factory=list)


# —— Synthea Schema Description for the LLM System Prompt ———————————
# This is an abbreviated, token-efficient description of the database
# that gives the LLM enough context to generate correct SQL.
# Column names match EXACTLY — the LLM uses these to write queries.

SCHEMA_DESCRIPTION = """
## DATABASE SCHEMA (Azure SQL / T-SQL syntax)

### Dimension tables:
- patients(Id, BIRTHDATE, DEATHDATE, SSN, DRIVERS, PASSPORT, PREFIX, FIRST, LAST, SUFFIX, MAIDEN, MARITAL, RACE, ETHNICITY, GENDER, BIRTHPLACE, ADDRESS, CITY, STATE, COUNTY, ZIP, LAT, LON, HEALTHCARE_EXPENSES, HEALTHCARE_COVERAGE)
- organizations(Id, NAME, ADDRESS, CITY, STATE, ZIP, LAT, LON, PHONE, REVENUE, UTILIZATION)
- providers(Id, ORGANIZATION, NAME, GENDER, SPECIALITY, ADDRESS, CITY, STATE, ZIP, LAT, LON, UTILIZATION)
- payers(Id, NAME, ADDRESS, CITY, STATE_HEADQUARTERED, ZIP, PHONE, AMOUNT_COVERED, AMOUNT_UNCOVERED, REVENUE, COVERED_ENCOUNTERS, UNCOVERED_ENCOUNTERS, UNIQUE_CUSTOMERS, QOLS_AVG, MEMBER_MONTHS)

### Clinical fact tables:
- encounters(Id, START, STOP, PATIENT, ORGANIZATION, PROVIDER, PAYER, ENCOUNTERCLASS, CODE, DESCRIPTION, BASE_ENCOUNTER_COST, TOTAL_CLAIM_COST, PAYER_COVERAGE, REASONCODE, REASONDESCRIPTION)
  ENCOUNTERCLASS values: 'wellness', 'ambulatory', 'outpatient', 'inpatient', 'emergency', 'urgentcare'
- conditions(ROW_ID, START, STOP, PATIENT, ENCOUNTER, CODE, DESCRIPTION)
  STOP is NULL for active/ongoing conditions
- medications(ROW_ID, START, STOP, PATIENT, PAYER, ENCOUNTER, CODE, DESCRIPTION, BASE_COST, PAYER_COVERAGE, DISPENSES, TOTALCOST, REASONCODE, REASONDESCRIPTION)
- observations(ROW_ID, DATE, PATIENT, ENCOUNTER, CATEGORY, CODE, DESCRIPTION, VALUE, UNITS, TYPE)
  CATEGORY values: 'vital-signs', 'laboratory', 'survey', 'social-history'
  VALUE is NVARCHAR — cast to FLOAT for numeric comparisons
- procedures(ROW_ID, START, STOP, PATIENT, ENCOUNTER, CODE, DESCRIPTION, BASE_COST, REASONCODE, REASONDESCRIPTION)
- immunizations(ROW_ID, DATE, PATIENT, ENCOUNTER, CODE, DESCRIPTION, BASE_COST)
- allergies(ROW_ID, START, STOP, PATIENT, ENCOUNTER, CODE, SYSTEM, DESCRIPTION, TYPE, CATEGORY, REACTION1, DESCRIPTION1, SEVERITY1, REACTION2, DESCRIPTION2, SEVERITY2)
- careplans(ROW_ID, Id, START, STOP, PATIENT, ENCOUNTER, CODE, DESCRIPTION, REASONCODE, REASONDESCRIPTION)
- devices(ROW_ID, START, STOP, PATIENT, ENCOUNTER, CODE, DESCRIPTION, UDI)
- supplies(ROW_ID, DATE, PATIENT, ENCOUNTER, CODE, DESCRIPTION, QUANTITY)
- imaging_studies(Id, DATE, PATIENT, ENCOUNTER, SERIES_UID, BODYSITE_CODE, BODYSITE_DESCRIPTION, MODALITY_CODE, MODALITY_DESCRIPTION, INSTANCE_UID, SOP_CODE, SOP_DESCRIPTION, PROCEDURE_CODE)

### Financial tables:
- claims(Id, PATIENTID, PROVIDERID, PRIMARYPATIENTINSURANCEID, SECONDARYPATIENTINSURANCEID, DEPARTMENTID, DIAGNOSIS1-8, REFERRINGPROVIDERID, APPOINTMENTID, CURRENTILLNESSDATE, SERVICEDATE, SUPERVISINGPROVIDERID, STATUS1, STATUS2, STATUSP, OUTSTANDING1, OUTSTANDING2, OUTSTANDINGP, LASTBILLEDDATE1, LASTBILLEDDATE2, LASTBILLEDDATEP, HEALTHCARECLAIMTYPEID1, HEALTHCARECLAIMTYPEID2)
  NOTE: PATIENTID and PROVIDERID (not PATIENT/PROVIDER like other tables)
- claims_transactions(ID, CLAIMID, CHARGEID, PATIENTID, TYPE, AMOUNT, METHOD, FROMDATE, TODATE, PLACEOFSERVICE, PROCEDURECODE, MODIFIER1, MODIFIER2, DIAGNOSISREF1-4, UNITS, DEPARTMENTID, NOTES, UNITAMOUNT, TRANSFEROUTID, TRANSFERTYPE, PAYMENTS, ADJUSTMENTS, TRANSFERS, OUTSTANDING, APPOINTMENTID, LINENOTE, PATIENTINSURANCEID, FEESCHEDULEID, PROVIDERID, SUPERVISINGPROVIDERID)
- payer_transitions(ROW_ID, PATIENT, MEMBERID, START_YEAR, END_YEAR, PAYER, SECONDARY_PAYER, OWNERSHIP, OWNERNAME)

### Key relationships:
- encounters.PATIENT → patients.Id
- encounters.ORGANIZATION → organizations.Id
- encounters.PROVIDER → providers.Id
- encounters.PAYER → payers.Id
- conditions/medications/observations/procedures.PATIENT → patients.Id
- conditions/medications/observations/procedures.ENCOUNTER → encounters.Id
- claims.PATIENTID → patients.Id (NOTE: column is PATIENTID not PATIENT)
- claims_transactions.CLAIMID → claims.Id

### Medical terminology mappings:
- "diabetic patients" → conditions.DESCRIPTION LIKE '%iabetes%'
- "hypertension" → conditions.DESCRIPTION LIKE '%ypertension%'
- "length of stay" → DATEDIFF(day, e.START, e.STOP)
- "readmission" → same patient, new encounter within 30 days of prior STOP
- "blood pressure" → observations.DESCRIPTION LIKE '%Blood Pressure%'
- "BMI" → observations.DESCRIPTION LIKE '%Body Mass Index%'
"""

FEW_SHOT_EXAMPLES = """
## EXAMPLES (natural language → T-SQL)

Q: How many patients do we have by gender?
SQL: SELECT p.GENDER, COUNT(*) as patient_count FROM patients p GROUP BY p.GENDER ORDER BY patient_count DESC

Q: What are the top 10 most common conditions?
SQL: SELECT TOP 10 c.DESCRIPTION, COUNT(DISTINCT c.PATIENT) as patient_count FROM conditions c GROUP BY c.DESCRIPTION ORDER BY patient_count DESC

Q: Show me total encounter costs by payer
SQL: SELECT py.NAME as payer_name, COUNT(*) as encounter_count, SUM(e.TOTAL_CLAIM_COST) as total_cost, AVG(e.TOTAL_CLAIM_COST) as avg_cost FROM encounters e JOIN payers py ON e.PAYER = py.Id GROUP BY py.NAME ORDER BY total_cost DESC

Q: What medications are most commonly prescribed for diabetes?
SQL: SELECT TOP 10 m.DESCRIPTION as medication, COUNT(*) as prescription_count FROM medications m WHERE m.REASONDESCRIPTION LIKE '%iabetes%' GROUP BY m.DESCRIPTION ORDER BY prescription_count DESC

Q: Show me the average BMI by age group
SQL: SELECT CASE WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) < 18 THEN 'Under 18' WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) BETWEEN 18 AND 39 THEN '18-39' WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) BETWEEN 40 AND 64 THEN '40-64' ELSE '65+' END as age_group, AVG(TRY_CAST(o.VALUE as FLOAT)) as avg_bmi, COUNT(DISTINCT o.PATIENT) as patient_count FROM observations o JOIN patients p ON o.PATIENT = p.Id WHERE o.DESCRIPTION LIKE '%Body Mass Index%' AND TRY_CAST(o.VALUE as FLOAT) IS NOT NULL GROUP BY CASE WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) < 18 THEN 'Under 18' WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) BETWEEN 18 AND 39 THEN '18-39' WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) BETWEEN 40 AND 64 THEN '40-64' ELSE '65+' END ORDER BY age_group
"""


class QueryEngine:
    """Orchestrates the complete NL-to-SQL pipeline."""

    MAX_RETRIES = 3

    def __init__(self):
        self.rbac_service = RBACService()
        self.sql_validator = SQLValidator()
        self.sql_rewriter = SQLRewriter()
        self.content_safety = ContentSafetyService()
        self.client = get_openai_client()
        self.model = settings.model_name

    async def execute_query(
        self,
        question: str,
        user_external_id: str,
        impersonated_by: str = None,
        conversation_history: list[dict] = None,
    ) -> QueryResult:
        """
        Full pipeline execution. This is the single entry point called
        by the query router.
        """
        result = QueryResult()
        start_time = time.time()

        # —— Step 1: Load RBAC context ———————————————————————
        try:
            role_ctx = self.rbac_service.get_role_context(
                user_external_id,
                impersonated_by=impersonated_by,
            )
        except ValueError as e:
            result.was_denied = True
            result.denial_reason = str(e)
            result.answer = f"Access denied: {str(e)}"
            result.confidence = "denied"
            result.execution_time_ms = int((time.time() - start_time) * 1000)
            return result

        result.role_name = role_ctx.role_name
        result.access_scope = role_ctx.row_scope

        # —— Step 2: Content Safety screening ——————————————————
        safety = self.content_safety.screen_input(question)
        result.content_safety_scores = safety.scores

        if not safety.is_safe:
            result.was_denied = True
            result.denial_reason = f"Content Safety: {safety.message}"
            result.answer = (
                "Your question was flagged by our content safety system. "
                f"Details: {safety.message}. Please rephrase your question."
            )
            result.confidence = "denied"
            result.execution_time_ms = int((time.time() - start_time) * 1000)
            await self._log_audit(result, role_ctx, question)
            return result

        # —— Step 3: Generate SQL (with retry loop) ————————————
        system_prompt = self._build_system_prompt(role_ctx)
        generated_sql = ""
        validation = None
        last_error = ""

        for attempt in range(self.MAX_RETRIES):
            result.retry_count = attempt

            generated_sql = self._generate_sql(
                question, system_prompt,
                conversation_history=conversation_history,
                previous_error=last_error if attempt > 0 else None,
            )
            result.generated_sql = generated_sql

            # —— Step 4: Validate SQL ——————————————————————————
            validation = self.sql_validator.validate(generated_sql, role_ctx)

            if validation.is_valid:
                break

            # Feed error back to LLM for self-correction
            last_error = "; ".join(validation.violations)

        # If still invalid after all retries, deny
        if not validation.is_valid:
            result.was_denied = True
            result.denial_reason = "; ".join(validation.violations)
            result.warnings = validation.violations
            result.tables_accessed = validation.tables_accessed
            result.answer = (
                f"I couldn't generate a query within your access permissions "
                f"({role_ctx.role_name}). {'; '.join(validation.violations)}"
            )
            result.confidence = "denied"
            result.execution_time_ms = int((time.time() - start_time) * 1000)
            await self._log_audit(result, role_ctx, question)
            return result

        result.tables_accessed = validation.tables_accessed
        result.warnings = validation.warnings

        # —— Step 5: Rewrite SQL with RBAC filters —————————————
        rewritten_sql, rewrite_explanation = self.sql_rewriter.rewrite(
            validation.sql, role_ctx
        )
        result.executed_sql = rewritten_sql
        result.was_modified = rewritten_sql != validation.sql
        result.modification_explanation = rewrite_explanation

        # —— Step 6: Execute against read-only DB ——————————————
        try:
            rows, columns = self._execute_sql(rewritten_sql)
            result.raw_results = rows
            result.result_columns = columns
            result.row_count = len(rows)
        except Exception as e:
            error_msg = str(e)[:300]
            result.answer = (
                f"The query executed but returned an error: {error_msg}. "
                f"This may be due to a data type mismatch or timeout."
            )
            result.confidence = "low"
            result.execution_time_ms = int((time.time() - start_time) * 1000)
            await self._log_audit(result, role_ctx, question)
            return result

        # —— Step 7: Generate explanation ——————————————————————
        result.answer = self._generate_explanation(
            question, generated_sql, rows, columns, role_ctx
        )

        # —— Step 8: Screen output —————————————————————————————
        output_safety = self.content_safety.screen_output(result.answer)
        if not output_safety.is_safe:
            result.answer = (
                "The generated response was flagged by content safety. "
                "The query returned data, but the explanation could not be displayed. "
                "Please try rephrasing your question."
            )

        # —— Step 9: Generate visualization spec ———————————————
        if result.row_count > 0 and result.row_count <= 100:
            result.visualization = self._generate_visualization(
                question, rows, columns
            )

        result.confidence = "high" if result.row_count > 0 else "medium"
        result.execution_time_ms = int((time.time() - start_time) * 1000)

        await self._log_audit(result, role_ctx, question)
        return result

    def _build_system_prompt(self, role_ctx: RoleContext) -> str:
        """Build the full system prompt with schema + role constraints."""
        return f"""You are an expert T-SQL analytics engineer for a healthcare system.
You convert natural language questions into safe, correct T-SQL queries
executed against Azure SQL Database containing synthetic patient data (Synthea).

{SCHEMA_DESCRIPTION}

{role_ctx.to_prompt_constraints()}

{FEW_SHOT_EXAMPLES}

## RULES
1. Return ONLY the raw SQL query. No markdown backticks, no explanation, no preamble.
2. Use T-SQL syntax (TOP instead of LIMIT, GETDATE(), DATEDIFF, TRY_CAST, etc.)
3. Always respect the access constraints above — they are mandatory, not suggestions.
4. Use table aliases for readability (p for patients, e for encounters, c for conditions, etc.)
5. If the question requires data outside the user's access, return a SQL comment explaining why.
6. Use TOP 500 unless the user specifies a different limit.
7. For observations.VALUE, always use TRY_CAST(VALUE as FLOAT) since VALUE is NVARCHAR.
8. Use LIKE with wildcards for condition/medication name matching (e.g., '%iabetes%').
"""

    def _generate_sql(
        self,
        question: str,
        system_prompt: str,
        conversation_history: list[dict] = None,
        previous_error: str = None,
    ) -> str:
        """Call Azure OpenAI to generate SQL."""
        messages = [{"role": "system", "content": system_prompt}]

        # Add conversation history for follow-up questions
        if conversation_history:
            for entry in conversation_history[-5:]:
                messages.append({"role": "user", "content": entry.get("question", "")})
                if entry.get("sql"):
                    messages.append({"role": "assistant", "content": entry["sql"]})

        # If retrying, include the error context
        if previous_error:
            messages.append({
                "role": "user",
                "content": (
                    f"The previous SQL had errors: {previous_error}\n"
                    f"Please fix the query for this question: {question}"
                ),
            })
        else:
            messages.append({"role": "user", "content": question})

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0,
                max_tokens=1000,
            )
            sql = response.choices[0].message.content.strip()

            # Strip markdown code fences if the LLM added them despite instructions
            if sql.startswith("```"):
                lines = sql.split("\n")
                sql = "\n".join(
                    l for l in lines if not l.strip().startswith("```")
                ).strip()

            return sql

        except Exception as e:
            return f"-- LLM Error: {str(e)[:200]}"

    def _execute_sql(self, sql: str) -> tuple[list[list], list[str]]:
        """
        Execute SQL against the read-only database connection.
        Returns (rows, column_names).
        Uses q2i_readonly user — even if the SQL contains mutations,
        the database rejects them (defense-in-depth Layer 4).
        """
        conn_string = settings.sql_readonly_connection_string
        if not conn_string:
            conn_string = settings.sql_connection_string

        conn = pyodbc.connect(conn_string, timeout=30)
        cursor = conn.cursor()

        try:
            cursor.execute(sql)
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = []
            for row in cursor.fetchmany(500):  # Hard cap at 500 rows
                rows.append([
                    str(val) if val is not None else None
                    for val in row
                ])
            return rows, columns
        finally:
            cursor.close()
            conn.close()

    def _generate_explanation(
        self,
        question: str,
        sql: str,
        rows: list[list],
        columns: list[str],
        role_ctx: RoleContext,
    ) -> str:
        """Call Azure OpenAI to explain query results in plain language."""
        if not rows:
            return (
                f"The query returned no results. This could mean the data doesn't "
                f"exist in the database, or your access level ({role_ctx.role_name}) "
                f"may have filtered it out."
            )

        # Truncate results for the prompt to save tokens
        sample = rows[:20]
        result_text = f"Columns: {', '.join(columns)}\n"
        for row in sample:
            result_text += " | ".join(str(v) for v in row) + "\n"
        if len(rows) > 20:
            result_text += f"... ({len(rows)} total rows)\n"

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a healthcare data analyst. Explain SQL query results "
                            "in clear, concise business language. Highlight key findings, "
                            "trends, and notable values. Use specific numbers from the data. "
                            "Keep the explanation to 2-4 sentences."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Question: {question}\n"
                            f"SQL: {sql}\n"
                            f"Results:\n{result_text}\n"
                            f"User role: {role_ctx.role_name} ({role_ctx.row_scope} scope)\n"
                            f"Explain these results."
                        ),
                    },
                ],
                temperature=0.3,
                max_tokens=300,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            return f"Query returned {len(rows)} rows but explanation generation failed: {str(e)[:100]}"

    def _generate_visualization(
        self,
        question: str,
        rows: list[list],
        columns: list[str],
    ) -> Optional[dict]:
        """
        Ask the LLM to recommend a chart type and format data for Recharts.
        Returns a JSON spec the frontend can render directly.
        """
        if len(columns) < 2 or len(rows) < 2:
            return None

        sample = rows[:30]
        data_preview = f"Columns: {json.dumps(columns)}\n"
        data_preview += f"First rows: {json.dumps(sample[:5])}\n"
        data_preview += f"Total rows: {len(rows)}"

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a data visualization expert. Given query results, "
                            "return ONLY a JSON object (no markdown, no explanation) with:\n"
                            '{"chartType": "bar"|"line"|"pie"|"scatter"|"table",\n'
                            ' "xKey": "column_name_for_x_axis",\n'
                            ' "yKey": "column_name_for_y_axis",\n'
                            ' "title": "Chart title",\n'
                            ' "data": [{...}, ...] }\n'
                            "Rules: bar for categories+counts, line for time series, "
                            "pie for proportions (<=8 slices), scatter for two numeric columns, "
                            "table if nothing fits well. data should use the actual column names as keys."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Question: {question}\n{data_preview}",
                    },
                ],
                temperature=0,
                max_tokens=2000,
            )

            text = response.choices[0].message.content.strip()
            if text.startswith("```"):
                text = "\n".join(
                    l for l in text.split("\n") if not l.strip().startswith("```")
                ).strip()

            return json.loads(text)
        except Exception:
            # Visualization is nice-to-have — don't break the pipeline
            return None

    async def _log_audit(
        self,
        result: QueryResult,
        role_ctx: RoleContext,
        question: str,
    ):
        """Write the query attempt to the audit log table."""
        try:
            conn = pyodbc.connect(settings.sql_connection_string)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO dbo.app_query_audit_log
                    (user_id, role_name, natural_language_query, generated_sql,
                     final_executed_sql, was_modified, was_denied, denial_reason,
                     tables_accessed, row_count_returned, execution_time_ms,
                     content_safety_score, sensitivity_classification)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                role_ctx.user_id,
                role_ctx.role_name,
                question,
                result.generated_sql,
                result.executed_sql,
                result.was_modified,
                result.was_denied,
                result.denial_reason[:500] if result.denial_reason else None,
                ", ".join(result.tables_accessed),
                result.row_count,
                result.execution_time_ms,
                json.dumps(result.content_safety_scores),
                role_ctx.sensitivity_tier,
            ))
            conn.commit()
            cursor.close()
            conn.close()
        except Exception as e:
            # Audit logging should never break the pipeline
            print(f"⚠ Audit log failed: {e}")
