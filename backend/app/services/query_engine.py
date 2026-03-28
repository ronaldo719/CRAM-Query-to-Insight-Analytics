"""
Query Engine -- Day 3: Full pipeline with Responsible AI + Innovation features.

Changes from Day 2:
  + Sensitivity classification (green/amber/red) before SQL generation
  + Conversation memory for follow-up questions
  + Bias detection on query results
  + Proactive follow-up suggestions after each answer
  + Enhanced audit logging with sensitivity + bias fields

Pipeline order:
  1. Load RoleContext (RBACService)
  2. Screen input (Content Safety)
  3. Classify sensitivity (green/amber/red)
  4. Generate SQL with conversation context (Azure OpenAI)
  5. Validate SQL (sqlglot + RBAC rules)
  6. Rewrite SQL (CTE wrapping for row filters)
  7. Execute SQL (read-only connection)
  8. Detect bias in results
  9. Generate explanation (Azure OpenAI)
  10. Screen output (Content Safety)
  11. Generate visualization spec
  12. Generate follow-up suggestions
  13. Store in conversation memory
  14. Audit log

  Query Engine -- Day 5: Added caching layer.

Only change from Day 3: cache check at the start of execute_query()
and cache store at the end. Cache is keyed by (question, role, scope)
so different roles get different cached results.

Cache is skipped for:
  - Denied queries (don't cache errors)
  - Queries with conversation history (follow-ups need fresh context)
"""

import re
import time
import json
import pyodbc
from typing import Optional
from dataclasses import dataclass, field

from app.config import settings, get_openai_client
from app.services.rbac_service import RBACService, RoleContext
from app.services.sql_validator import SQLValidator
from app.services.sql_rewriter import SQLRewriter
from app.services.content_safety_service import ContentSafetyService
from app.services.sensitivity_classifier import SensitivityClassifier
from app.services.conversation_manager import ConversationManager
from app.services.bias_detector import BiasDetector
from app.services.cache_service import CacheService


@dataclass
class QueryResult:
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
    sensitivity_level: str = "green"
    sensitivity_reason: str = ""
    sensitivity_advisory: str = ""
    bias_alert: Optional[str] = None
    suggestions: list[str] = field(default_factory=list)
    was_denied: bool = False
    denial_reason: str = ""
    content_safety_scores: dict = field(default_factory=dict)
    retry_count: int = 0
    raw_results: list = field(default_factory=list)
    result_columns: list[str] = field(default_factory=list)
    from_cache: bool = False


# -- Schema and few-shot examples (unchanged from Day 2) ------

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
- medications(ROW_ID, START, STOP, PATIENT, PAYER, ENCOUNTER, CODE, DESCRIPTION, BASE_COST, PAYER_COVERAGE, DISPENSES, TOTALCOST, REASONCODE, REASONDESCRIPTION)
- observations(ROW_ID, DATE, PATIENT, ENCOUNTER, CATEGORY, CODE, DESCRIPTION, VALUE, UNITS, TYPE)
  VALUE is NVARCHAR -- use TRY_CAST(VALUE as FLOAT) for numeric comparisons
- procedures(ROW_ID, START, STOP, PATIENT, ENCOUNTER, CODE, DESCRIPTION, BASE_COST, REASONCODE, REASONDESCRIPTION)
- immunizations(ROW_ID, DATE, PATIENT, ENCOUNTER, CODE, DESCRIPTION, BASE_COST)
- allergies(ROW_ID, START, STOP, PATIENT, ENCOUNTER, CODE, SYSTEM, DESCRIPTION, TYPE, CATEGORY, REACTION1, DESCRIPTION1, SEVERITY1, REACTION2, DESCRIPTION2, SEVERITY2)
- careplans(ROW_ID, Id, START, STOP, PATIENT, ENCOUNTER, CODE, DESCRIPTION, REASONCODE, REASONDESCRIPTION)
- devices(ROW_ID, START, STOP, PATIENT, ENCOUNTER, CODE, DESCRIPTION, UDI)
- supplies(ROW_ID, DATE, PATIENT, ENCOUNTER, CODE, DESCRIPTION, QUANTITY)
- imaging_studies(Id, DATE, PATIENT, ENCOUNTER, SERIES_UID, BODYSITE_CODE, BODYSITE_DESCRIPTION, MODALITY_CODE, MODALITY_DESCRIPTION, INSTANCE_UID, SOP_CODE, SOP_DESCRIPTION, PROCEDURE_CODE)

### Financial tables:
- claims(Id, PATIENTID, PROVIDERID, PRIMARYPATIENTINSURANCEID, SECONDARYPATIENTINSURANCEID, DEPARTMENTID, DIAGNOSIS1-8, REFERRINGPROVIDERID, APPOINTMENTID, CURRENTILLNESSDATE, SERVICEDATE, SUPERVISINGPROVIDERID, STATUS1, STATUS2, STATUSP, OUTSTANDING1, OUTSTANDING2, OUTSTANDINGP, LASTBILLEDDATE1-LASTBILLEDDATEP, HEALTHCARECLAIMTYPEID1, HEALTHCARECLAIMTYPEID2)
  NOTE: PATIENTID (not PATIENT)
- claims_transactions(ID, CLAIMID, CHARGEID, PATIENTID, TYPE, AMOUNT, METHOD, FROMDATE, TODATE, PLACEOFSERVICE, PROCEDURECODE, MODIFIER1-2, DIAGNOSISREF1-4, UNITS, DEPARTMENTID, NOTES, UNITAMOUNT, TRANSFEROUTID, TRANSFERTYPE, PAYMENTS, ADJUSTMENTS, TRANSFERS, OUTSTANDING, APPOINTMENTID, LINENOTE, PATIENTINSURANCEID, FEESCHEDULEID, PROVIDERID, SUPERVISINGPROVIDERID)
- payer_transitions(ROW_ID, PATIENT, MEMBERID, START_YEAR, END_YEAR, PAYER, SECONDARY_PAYER, OWNERSHIP, OWNERNAME)

### Key relationships:
- encounters.PATIENT -> patients.Id
- encounters.ORGANIZATION -> organizations.Id
- encounters.PROVIDER -> providers.Id
- encounters.PAYER -> payers.Id
- conditions/medications/observations/procedures.PATIENT -> patients.Id
- conditions/medications/observations/procedures.ENCOUNTER -> encounters.Id
- claims.PATIENTID -> patients.Id
- claims_transactions.CLAIMID -> claims.Id

### Medical terminology mappings:
- "diabetic" -> conditions.DESCRIPTION LIKE '%iabetes%'
- "hypertension" -> conditions.DESCRIPTION LIKE '%ypertension%'
- "length of stay" -> DATEDIFF(day, e.START, e.STOP)
- "blood pressure" -> observations.DESCRIPTION LIKE '%Blood Pressure%'
- "BMI" -> observations.DESCRIPTION LIKE '%Body Mass Index%'
"""

FEW_SHOT_EXAMPLES = """
## EXAMPLES

Q: How many patients by gender?
SQL: SELECT p.GENDER, COUNT(*) as patient_count FROM patients p GROUP BY p.GENDER ORDER BY patient_count DESC

Q: Top 10 most common conditions?
SQL: SELECT TOP 10 c.DESCRIPTION, COUNT(DISTINCT c.PATIENT) as patient_count FROM conditions c GROUP BY c.DESCRIPTION ORDER BY patient_count DESC

Q: Total encounter costs by payer
SQL: SELECT py.NAME as payer_name, COUNT(*) as encounter_count, SUM(e.TOTAL_CLAIM_COST) as total_cost, AVG(e.TOTAL_CLAIM_COST) as avg_cost FROM encounters e JOIN payers py ON e.PAYER = py.Id GROUP BY py.NAME ORDER BY total_cost DESC

Q: Medications prescribed for diabetes
SQL: SELECT TOP 10 m.DESCRIPTION as medication, COUNT(*) as rx_count FROM medications m WHERE m.REASONDESCRIPTION LIKE '%iabetes%' GROUP BY m.DESCRIPTION ORDER BY rx_count DESC

Q: Average BMI by age group
SQL: SELECT CASE WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) < 18 THEN 'Under 18' WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) BETWEEN 18 AND 39 THEN '18-39' WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) BETWEEN 40 AND 64 THEN '40-64' ELSE '65+' END as age_group, AVG(TRY_CAST(o.VALUE as FLOAT)) as avg_bmi, COUNT(DISTINCT o.PATIENT) as patient_count FROM observations o JOIN patients p ON o.PATIENT = p.Id WHERE o.DESCRIPTION LIKE '%Body Mass Index%' AND TRY_CAST(o.VALUE as FLOAT) IS NOT NULL GROUP BY CASE WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) < 18 THEN 'Under 18' WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) BETWEEN 18 AND 39 THEN '18-39' WHEN DATEDIFF(year, p.BIRTHDATE, GETDATE()) BETWEEN 40 AND 64 THEN '40-64' ELSE '65+' END ORDER BY age_group
"""


class QueryEngine:

    MAX_RETRIES = 3

    def __init__(self):
        self.rbac_service = RBACService()
        self.sql_validator = SQLValidator()
        self.sql_rewriter = SQLRewriter()
        self.content_safety = ContentSafetyService()
        self.sensitivity_classifier = SensitivityClassifier()
        self.conversation_manager = ConversationManager()
        self.bias_detector = BiasDetector()
        self.cache = CacheService()
        self.client = get_openai_client()
        self.model = settings.model_name

    async def execute_query(
        self,
        question: str,
        user_external_id: str,
        impersonated_by: str = None,
    ) -> QueryResult:
        result = QueryResult()
        start_time = time.time()

        # -- 1. Load RBAC context -----------------------------
        try:
            role_ctx = self.rbac_service.get_role_context(
                user_external_id, impersonated_by=impersonated_by
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

        # -- 1.5 CACHE CHECK ----------------------------------
        # Only check cache for standalone queries (not follow-ups)
        has_history = bool(self.conversation_manager.get_history(user_external_id))
        if not has_history:
            cached = self.cache.get(question, role_ctx.role_name, role_ctx.row_scope)
            if cached:
                result.answer = cached.get("answer", "")
                result.visualization = cached.get("visualization")
                result.generated_sql = cached.get("generated_sql", "")
                result.executed_sql = cached.get("executed_sql", "")
                result.was_modified = cached.get("was_modified", False)
                result.modification_explanation = cached.get("modification_explanation", "")
                result.tables_accessed = cached.get("tables_accessed", [])
                result.row_count = cached.get("row_count", 0)
                result.sensitivity_level = cached.get("sensitivity_level", "green")
                result.sensitivity_advisory = cached.get("sensitivity_advisory", "")
                result.bias_alert = cached.get("bias_alert")
                result.result_columns = cached.get("result_columns", [])
                result.raw_results = cached.get("result_rows", [])
                result.confidence = cached.get("confidence", "high")
                result.from_cache = True
                result.execution_time_ms = int((time.time() - start_time) * 1000)
                result.warnings = ["Served from cache"]
                # Still generate fresh suggestions
                result.suggestions = self.conversation_manager.generate_suggestions(
                    user_external_id, role_ctx
                )
                return result

        # -- 1b. Billing clinical query guard -----------------
        if role_ctx.role_name == "billing" and self._is_clinical_query(question):
            result.was_denied = True
            result.denial_reason = "Clinical query not permitted for billing role"
            result.answer = (
                "This question involves clinical data (diagnoses, medications, procedures, etc.) "
                "which is not accessible to the billing role. Billing access is limited to "
                "financial data such as claims, costs, payments, and payer information. "
                "Please contact a clinical role (physician, nurse) for medical queries."
            )
            result.confidence = "denied"
            result.sensitivity_level = "red"
            result.execution_time_ms = int((time.time() - start_time) * 1000)
            result.suggestions = self.conversation_manager.generate_suggestions(
                user_external_id, role_ctx
            )
            await self._log_audit(result, role_ctx, question)
            return result

        # -- 2. Content Safety screening ----------------------
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

        # -- 3. Sensitivity classification --------------------
        sensitivity = self.sensitivity_classifier.classify(question, role_ctx)
        result.sensitivity_level = sensitivity.level
        result.sensitivity_reason = sensitivity.reason
        result.sensitivity_advisory = sensitivity.advisory

        if sensitivity.should_block:
            result.was_denied = True
            result.denial_reason = f"Sensitivity: {sensitivity.reason}"
            result.answer = sensitivity.advisory
            result.confidence = "denied"
            result.execution_time_ms = int((time.time() - start_time) * 1000)
            result.suggestions = self.conversation_manager.generate_suggestions(
                user_external_id, role_ctx
            )
            await self._log_audit(result, role_ctx, question)
            return result

        # -- 4. Generate SQL (with conversation context + retry)
        system_prompt = self._build_system_prompt(role_ctx)
        conversation_history = self.conversation_manager.get_history(user_external_id)
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

            # -- 5. Validate SQL ------------------------------
            validation = self.sql_validator.validate(generated_sql, role_ctx)

            if validation.is_valid:
                break

            last_error = "; ".join(validation.violations)

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
            result.suggestions = self.conversation_manager.generate_suggestions(
                user_external_id, role_ctx
            )
            await self._log_audit(result, role_ctx, question)
            return result

        result.tables_accessed = validation.tables_accessed
        result.warnings = validation.warnings

        # -- 6. Rewrite SQL with RBAC filters -----------------
        rewritten_sql, rewrite_explanation = self.sql_rewriter.rewrite(
            validation.sql, role_ctx
        )
        result.executed_sql = rewritten_sql
        result.was_modified = rewritten_sql != validation.sql
        result.modification_explanation = rewrite_explanation

        # -- 7. Execute against read-only DB ------------------
        try:
            rows, columns = self._execute_sql(rewritten_sql)
            result.raw_results = rows
            result.result_columns = columns
            result.row_count = len(rows)
        except Exception as e:
            result.answer = f"Query execution error: {str(e)[:300]}"
            result.confidence = "low"
            result.execution_time_ms = int((time.time() - start_time) * 1000)
            await self._log_audit(result, role_ctx, question)
            return result

        # -- 8. Bias detection --------------------------------
        bias = self.bias_detector.check_results(columns, rows)
        if bias and bias.has_disparity:
            result.bias_alert = bias.message
            result.warnings.append(bias.message)

        # -- 9. Generate explanation --------------------------
        result.answer = self._generate_explanation(
            question, generated_sql, rows, columns, role_ctx
        )

        # Append sensitivity advisory if amber
        if sensitivity.level == "amber" and sensitivity.advisory:
            result.answer += f"\n\n{sensitivity.advisory}"

        # -- 10. Screen output --------------------------------
        output_safety = self.content_safety.screen_output(result.answer)
        if not output_safety.is_safe:
            result.answer = (
                "The generated response was flagged by content safety. "
                "The query returned data, but the explanation cannot be displayed."
            )

        # -- 11. Visualization --------------------------------
        if result.row_count > 0 and result.row_count <= 100:
            result.visualization = self._generate_visualization(
                question, rows, columns
            )

        # -- 12. Generate follow-up suggestions ---------------
        self.conversation_manager.add_entry(
            user_id=user_external_id,
            question=question,
            sql=generated_sql,
            answer=result.answer[:200],
            role_name=role_ctx.role_name,
            row_count=result.row_count,
        )
        result.suggestions = self.conversation_manager.generate_suggestions(
            user_external_id, role_ctx
        )

        result.confidence = "high" if result.row_count > 0 else "medium"
        result.execution_time_ms = int((time.time() - start_time) * 1000)

        # -- 12b. Cache store ---------------------------------
        if not result.was_denied and result.row_count > 0:
            self.cache.put(
                question, role_ctx.role_name, role_ctx.row_scope,
                {
                    "answer": result.answer,
                    "visualization": result.visualization,
                    "generated_sql": result.generated_sql,
                    "executed_sql": result.executed_sql,
                    "was_modified": result.was_modified,
                    "modification_explanation": result.modification_explanation,
                    "tables_accessed": result.tables_accessed,
                    "row_count": result.row_count,
                    "sensitivity_level": result.sensitivity_level,
                    "sensitivity_advisory": result.sensitivity_advisory,
                    "bias_alert": result.bias_alert,
                    "result_columns": result.result_columns,
                    "result_rows": result.raw_results[:100],
                    "confidence": result.confidence,
                },
            )

        # -- 13. Audit log ------------------------------------
        await self._log_audit(result, role_ctx, question)
        return result

    def clear_conversation(self, user_external_id: str):
        """Clear conversation history for a user (called on role switch)."""
        self.conversation_manager.clear(user_external_id)

    def get_cache_stats(self) -> dict:
        return self.cache.stats()

    # Clinical terms that indicate non-financial intent
    _CLINICAL_KEYWORDS = re.compile(
        r"\b("
        r"condition|conditions|diagnosis|diagnoses|diagnosed|"
        r"medication|medications|drug|drugs|prescription|prescriptions|"
        r"procedure|procedures|surgery|surgeries|"
        r"observation|observations|vital|vitals|lab result|lab results|"
        r"immunization|immunizations|vaccine|vaccines|vaccination|"
        r"allergy|allergies|allergic|"
        r"careplan|careplans|care plan|care plans|"
        r"symptom|symptoms|clinical|"
        r"blood pressure|heart rate|bmi|body mass|"
        r"diabetes|diabetic|hypertension|asthma|cancer|infection|"
        r"disease|disorder|syndrome|chronic|acute|"
        r"treatment|treatments|therapy|therapies"
        r")\b",
        re.IGNORECASE,
    )

    def _is_clinical_query(self, question: str) -> bool:
        """Check if a question is clinical in nature (for billing role guard)."""
        return bool(self._CLINICAL_KEYWORDS.search(question))

    def _build_system_prompt(self, role_ctx: RoleContext) -> str:
        return f"""You are an expert T-SQL analytics engineer for a healthcare system.
Convert natural language questions into safe, correct T-SQL queries for Azure SQL Database
containing synthetic patient data (Synthea).

{SCHEMA_DESCRIPTION}

{role_ctx.to_prompt_constraints()}

{FEW_SHOT_EXAMPLES}

## RULES
1. Return ONLY the raw SQL query. No markdown backticks, no explanation.
2. Use T-SQL syntax (TOP not LIMIT, GETDATE(), DATEDIFF, TRY_CAST).
3. Always respect access constraints -- they are mandatory.
4. Use table aliases (p=patients, e=encounters, c=conditions, m=medications, o=observations).
5. Use TOP 500 unless the user specifies a limit.
6. For observations.VALUE, use TRY_CAST(VALUE as FLOAT).
7. Use LIKE with wildcards for condition/medication matching.
8. If the question is a follow-up referencing "that" or "those", use context from previous queries.
"""

    def _generate_sql(self, question, system_prompt, conversation_history=None, previous_error=None):
        messages = [{"role": "system", "content": system_prompt}]

        if conversation_history:
            for entry in conversation_history[-5:]:
                messages.append({"role": "user", "content": entry.get("question", "")})
                if entry.get("sql"):
                    messages.append({"role": "assistant", "content": entry["sql"]})

        if previous_error:
            messages.append({
                "role": "user",
                "content": f"Previous SQL had errors: {previous_error}\nFix the query for: {question}",
            })
        else:
            messages.append({"role": "user", "content": question})

        try:
            response = self.client.chat.completions.create(
                model=self.model, messages=messages,
                temperature=0, max_tokens=1000,
            )
            sql = response.choices[0].message.content.strip()
            if sql.startswith("```"):
                sql = "\n".join(line for line in sql.split("\n") if not line.strip().startswith("```")).strip()
            return sql
        except Exception as e:
            return f"-- LLM Error: {str(e)[:200]}"

    def _execute_sql(self, sql):
        conn_string = settings.sql_readonly_connection_string or settings.sql_connection_string
        conn = pyodbc.connect(conn_string, timeout=30)
        cursor = conn.cursor()
        try:
            cursor.execute(sql)
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = [[str(val) if val is not None else None for val in row] for row in cursor.fetchmany(500)]
            return rows, columns
        finally:
            cursor.close()
            conn.close()

    def _generate_explanation(self, question, sql, rows, columns, role_ctx):
        if not rows:
            return (
                f"The query returned no results. Your access level ({role_ctx.role_name}, "
                f"{role_ctx.row_scope} scope) may have filtered out the matching data, "
                f"or the data may not exist in the database."
            )

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
                    {"role": "system", "content": (
                        "You are a healthcare data analyst. Explain SQL query results "
                        "in clear, concise business language. Highlight key findings "
                        "and notable values. Use specific numbers. Keep to 2-4 sentences."
                    )},
                    {"role": "user", "content": (
                        f"Question: {question}\nSQL: {sql}\n"
                        f"Results:\n{result_text}\n"
                        f"User: {role_ctx.display_name} ({role_ctx.role_name})\n"
                        f"Explain these results."
                    )},
                ],
                temperature=0.3, max_tokens=300,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            return f"Query returned {len(rows)} rows. (Explanation unavailable: {str(e)[:100]})"

    def _generate_visualization(self, question, rows, columns):
        if len(columns) < 2 or len(rows) < 2:
            return None

        data_preview = f"Columns: {json.dumps(columns)}\nFirst rows: {json.dumps(rows[:5])}\nTotal: {len(rows)}"

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": (
                        "Data viz expert. Return ONLY JSON (no markdown):\n"
                        '{"chartType":"bar"|"line"|"pie"|"scatter"|"table",'
                        '"xKey":"col","yKey":"col","title":"title","data":[{...}]}\n'
                        "bar=categories+counts, line=time, pie=proportions(<=8), scatter=2 numerics."
                    )},
                    {"role": "user", "content": f"Question: {question}\n{data_preview}"},
                ],
                temperature=0, max_tokens=2000,
            )
            text = response.choices[0].message.content.strip()
            if text.startswith("```"):
                text = "\n".join(line for line in text.split("\n") if not line.strip().startswith("```")).strip()
            return json.loads(text)
        except Exception:
            return None

    async def _log_audit(self, result, role_ctx, question):
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
                role_ctx.user_id, role_ctx.role_name, question,
                result.generated_sql, result.executed_sql,
                result.was_modified, result.was_denied,
                result.denial_reason[:500] if result.denial_reason else None,
                ", ".join(result.tables_accessed), result.row_count,
                result.execution_time_ms,
                json.dumps(result.content_safety_scores),
                result.sensitivity_level,
            ))
            conn.commit()
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"Audit log: {e}")
