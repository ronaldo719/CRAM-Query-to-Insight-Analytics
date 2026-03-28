# CRAM — Query-to-Insight Analytics Engine
**Microsoft Innovation Challenge 2026**

An agentic analytics engineer that converts natural language questions into validated, RBAC-filtered SQL queries against a clinical/financial database, then explains the results in plain language — with built-in Responsible AI guardrails and conversational follow-up.

---

## Day 4 — Production-Quality Frontend + Billing Clinical Guard

### What's Built

**14-Step NL-to-SQL Pipeline** — A single `POST /api/query/ask` call runs:

```
JWT auth → RBAC context → Billing clinical guard → Content Safety →
Sensitivity classification → SQL generation (with conversation context) →
sqlglot validation (3× retry) → RBAC rewriting → execution →
Bias detection → explanation → Output safety → visualization →
Follow-up suggestions → Conversation storage → Audit log
```

**Production Frontend** — Polished component-based UI with auto-visualization (Recharts), sortable data tables, RAI status banner, and admin audit dashboard.

**Billing Clinical Guard** — Regex keyword detection + LLM prompt constraints deny clinical queries for billing role before SQL generation, preventing workarounds via allowed tables.

### Responsible AI Features (6 Microsoft Principles)

| Principle | Implementation |
|-----------|---------------|
| **Fairness** | Bias detector flags >20% demographic disparities in query results |
| **Reliability & Safety** | Content Safety screens input/output; 3× self-correction loop |
| **Privacy & Security** | Sensitivity classifier (green/amber/red) blocks PII and stigmatized condition queries |
| **Inclusiveness** | Role-based access ensures each user sees appropriate data |
| **Transparency** | SQL transparency panel shows generated/executed SQL; modification explanations |
| **Accountability** | Full audit log with denial reasons, latency, safety scores per query |

### Innovation Features

| Feature | Description |
|---------|-------------|
| **Conversation memory** | Last 5 Q&A pairs per session; follow-ups like "break that down by age" resolve correctly |
| **Proactive suggestions** | 3 contextual follow-up questions generated after each answer (clickable chips) |
| **Bias detection** | Scans results for demographic dimensions + outcome measures; flags disparities |
| **Sensitivity classification** | Two-tier (rule-based + LLM) query classification before SQL generation |
| **Audit dashboard** | Admin panel with total queries, denial rate, RBAC modifications, latency stats |
| **Auto-visualization** | LLM-generated chart specs rendered as bar, line, pie, or scatter charts via Recharts |
| **Billing clinical guard** | Regex keyword + LLM prompt deny clinical queries for billing role pre-SQL-generation |
| **Two-tier query cache** | L1 in-memory (200 entries) + L2 Azure Cache for Redis; 1hr TTL; cache key is role+scope-aware; served hits skip all 14 pipeline steps; graceful L1-only fallback |

---

## Project Structure

```
CRAM-Query-to-Insight-Analytics/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                          # FastAPI entry, CORS, router registration
│   │   ├── config.py                        # Settings + OpenAI client factory
│   │   ├── dependencies/
│   │   │   └── auth.py                      # get_current_user, require_admin
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py                      # /api/auth/* endpoints
│   │   │   ├── query.py                     # /api/query/ask + /clear-history
│   │   │   └── audit.py                     # /api/audit/stats + /log (admin)
│   │   └── services/
│   │       ├── __init__.py
│   │       ├── auth_service.py              # bcrypt hashing, JWT, DB auth
│   │       ├── rbac_service.py              # RoleContext loader from DB
│   │       ├── content_safety_service.py    # Azure Content Safety screening
│   │       ├── sql_validator.py             # 8-layer sqlglot validation
│   │       ├── sql_rewriter.py              # RBAC filter injection (CTE + inline)
│   │       ├── query_engine.py              # 14-step pipeline orchestrator
│   │       ├── sensitivity_classifier.py    # Green/amber/red classification
│   │       ├── conversation_manager.py      # Session memory + suggestions
│   │       ├── bias_detector.py             # Demographic disparity alerts
│   │       └── cache_service.py             # Two-tier L1/L2 Redis cache
│   ├── scripts/
│   │   ├── setup_database.py               # Schema + Synthea data loading
│   │   └── migrate_auth.py                 # Password seeding
│   ├── requirements.txt
│   └── test_openai.py
├── frontend/
│   ├── src/
│   │   ├── App.tsx                          # Polished layout with all components
│   │   ├── AuthContext.tsx                  # Session state, authFetch, impersonation
│   │   ├── LoginPage.tsx                    # Login form + demo quick-login
│   │   ├── main.jsx
│   │   ├── index.css                        # Global styles, keyframes, scrollbar
│   │   └── components/
│   │       ├── ChartRenderer.tsx            # Recharts auto-visualization engine
│   │       ├── ResultsTable.tsx             # Sortable data table
│   │       ├── RAIBanner.tsx                # Responsible AI status bar
│   │       └── AuditDashboard.tsx           # Admin audit statistics panel
│   ├── tsconfig.json
│   └── package.json
├── .env                                     # gitignored — secrets
└── .gitignore
```

---

## Query Pipeline — 14 Steps

```
                    ┌─────────────────────────────────────────────┐
                    │            POST /api/query/ask              │
                    │              { question }                   │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  1. Load RBAC Context                       │
                    │  app_users → app_roles → column_access      │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  1b. Billing Clinical Guard                 │
                    │  Deny clinical queries for billing role     │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  2. Content Safety Screening                │
                    │  Block harmful input before any processing  │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  3. Sensitivity Classification              │
                    │  Rule-based → LLM fallback                  │
                    │  GREEN: proceed | AMBER: advisory | RED: block│
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  4. Generate SQL (Azure OpenAI)             │
                    │  Schema + role constraints + conversation   │
                    │  history included in prompt                 │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  5. Validate SQL (sqlglot, 8 layers)        │
                    │  ↻ Retry up to 3× with error feedback      │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  6. Rewrite SQL with RBAC Filters           │
                    │  CTE wrapper or inline injection            │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  7. Execute SQL (read-only connection)      │
                    │  30s timeout, 500 row cap                   │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  8. Bias Detection                          │
                    │  Scan for demographic disparities (>20%)    │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  9. Generate Explanation (Azure OpenAI)     │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  10. Screen Output (Content Safety)         │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  11. Generate Visualization Spec            │
                    │  bar / line / pie / scatter / table         │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  12. Generate Follow-up Suggestions         │
                    │  3 contextual questions via LLM             │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  13. Store in Conversation Memory           │
                    │  Last 5 Q&A pairs per user session          │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  14. Audit Log                              │
                    │  User, role, SQL, timing, sensitivity,      │
                    │  safety scores → dbo.app_query_audit_log    │
                    └─────────────────────────────────────────────┘
```

---

## Sensitivity Classification

The `SensitivityClassifier` evaluates each query **before SQL generation** using a two-tier approach:

**Tier 1 — Rule-based (zero API calls):**
- Stigmatized conditions (HIV, substance abuse, mental health) + individual access → RED
- PII requests (SSN, passport, drivers license) without PII permission → RED
- Demographic correlations (by race, by ethnicity, disparities) → AMBER
- Standard analytics (count, total, average, top) → GREEN

**Tier 2 — LLM classification (ambiguous queries only):**
- Single API call to classify as GREEN/AMBER/RED with reason

| Level | UI | Behavior |
|-------|----|----------|
| GREEN | Green dot badge | Proceed silently |
| AMBER | Amber dot + advisory notice | Proceed with contextual warning |
| RED | Red dot + blocked | Query blocked, explanation shown |

---

## Bias Detection

The `BiasDetector` analyzes query results **after execution**:

1. Scans column names for **demographic dimensions** (race, gender, ethnicity, age_group)
2. Scans for **outcome measures** (count, cost, average, rate)
3. When both are present, calculates variation across groups
4. If disparity exceeds **20% threshold**, generates a fairness notice

Example output:
> Demographic disparity detected: 'avg_healthcare_expenses' varies by 95% across 'RACE' groups (highest: asian, lowest: native). This may reflect underlying health disparities, data collection biases, or social determinants of health. Consider consulting domain experts before drawing conclusions.

---

## Conversation Manager

- **Session memory**: Stores last 5 question/SQL pairs per user (in-memory, keyed by `external_id`)
- **Context resolution**: Follow-up questions like "now break that down by age group" include prior query history in the LLM prompt
- **Proactive suggestions**: After each answer, generates 3 follow-up questions via LLM; displayed as clickable chips
- **Role isolation**: `POST /api/query/clear-history` resets memory on role switch to prevent context leakage

---

## SQL Validation — 8 Layers

| Layer | Check | Action |
|-------|-------|--------|
| 1 | **Parse** | Reject unparseable SQL |
| 2 | **No mutations** | Block INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, GRANT |
| 3 | **No system tables** | Block `sys.*`, `information_schema.*`, `app_users`, `app_roles`, etc. |
| 4 | **Table-level access** | Only allow tables in the role's `allowed_tables` list |
| 5 | **Column-level access** | Block columns in the role's deny list (e.g., PII columns) |
| 6 | **Aggregate enforcement** | Researcher role must use GROUP BY + aggregate functions |
| 7 | **TOP injection** | Add `TOP 500` if missing (handles `SELECT DISTINCT` correctly) |
| 8 | **Row scope check** | Warn if provider/org filter is missing (rewriter will inject it) |

---

## SQL Rewriter — Defense in Depth

The rewriter **unconditionally** enforces row-level access, using two strategies depending on query type:

**Non-aggregate queries** — CTE wrapper:
```sql
-- RBAC: filtered to provider e5a3f7ff-...
SELECT rbac_outer.* FROM (
    <original LLM query>
) rbac_outer
WHERE EXISTS (
    SELECT 1 FROM dbo.encounters rbac_enc
    WHERE rbac_enc.PATIENT = rbac_outer.Id
      AND rbac_enc.PROVIDER = 'e5a3f7ff-...'
)
```

**Aggregate queries (GROUP BY)** — Inline injection:
- Detects existing provider/org filters and skips if already present
- Otherwise injects `EXISTS` subquery into the WHERE clause before GROUP BY

| Scope | Filter |
|-------|--------|
| `own_patients` | `encounters.PROVIDER = '{provider_id}'` |
| `department` | `encounters.ORGANIZATION = '{organization_id}'` |
| `aggregate_only` | Injects `HAVING COUNT(*) >= 5` for k-anonymity |
| `all` | No rewriting needed |

---

## Two-Tier Query Cache

The `CacheService` short-circuits the full 14-step pipeline for repeated questions, dramatically reducing latency and LLM API cost.

### Architecture

| Tier | Backend | Capacity | Scope |
|------|---------|----------|-------|
| **L1** | Python `dict` (in-process) | 200 entries (LRU eviction) | Per server process |
| **L2** | Azure Cache for Redis (TLS) | Unlimited | Shared across all processes |

### Cache Key

```
q2i:<SHA256(question.lower() + role + row_scope)[:16]>
```

Role and row scope are included so that a Physician and a Researcher asking identical questions receive their respective RBAC-filtered results independently.

### Behavior

**Cache hit** — Returns instantly; skips all 14 pipeline steps. Fresh follow-up suggestions are still generated. Response includes `from_cache: true`.

**Cache miss** — Full pipeline runs; result stored in both L1 and L2 at completion (only for non-denied, non-empty results).

**Eligibility** — Only standalone queries are cached; follow-ups that carry conversation history are always executed fresh.

**TTL** — 3600 seconds (1 hour) for both tiers. Redis handles L2 expiration natively via `SETEX`.

**Graceful degradation** — If Redis is unavailable, the service logs a warning and continues with L1 only. The query pipeline is never blocked.

### Cache Statistics

`GET /api/query/cache-stats` (Admin only) returns:
```json
{ "l1_entries": 42, "l2_available": true }
```

---

## Content Safety Integration

Azure AI Content Safety screens text at **two points**:

1. **Before the LLM** — Block harmful user questions (prompt injection, hate, violence, etc.)
2. **After the LLM** — Catch harmful content in generated explanations

**Graceful degradation:** If Content Safety is not configured, the service logs a warning and allows requests through.

---

## Verified Test Scenarios

| # | Scenario | Query | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | **Green sensitivity** | "How many patients by gender?" | GREEN badge, no advisory | ✅ 2 rows, suggestions generated |
| 2 | **Amber sensitivity** | "What is diabetes prevalence by race?" | AMBER badge + advisory + bias alert | ✅ 6 rows, 94% disparity flagged |
| 3 | **Red sensitivity** | "List individual patients with HIV and their addresses" | RED, query blocked | ✅ Blocked with privacy explanation |
| 4 | **Follow-up conversation** | "Break that down by age group" | Uses prior query context | ✅ 16 rows, age+race breakdown |
| 5 | **Bias detection** | "Compare average healthcare costs by race" | AMBER + fairness notice | ✅ 95% disparity flagged |
| 6 | **Audit dashboard** | Admin clicks "Show audit log" | Stats panel renders | ✅ Total queries, denial rate, by-role breakdown |
| 7 | **Physician RBAC** | Doctor: "How many patients by gender?" | Own patients only | ✅ 6 patients (4F, 2M), provider filter applied |
| 8 | **Billing denied** | Billing: "Show me patients with diabetes" | Clinical query blocked pre-SQL | ✅ RED/denied immediately, no SQL generated |
| 9 | **Researcher k-anonymity** | Researcher: "Count conditions by type" | Aggregate + HAVING | ✅ k-anonymity enforced |

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check |
| `POST` | `/api/auth/login` | No | Authenticate, set `q2i_token` cookie |
| `POST` | `/api/auth/logout` | No | Clear cookie |
| `GET` | `/api/auth/me` | Cookie | Current user (or impersonated user) |
| `POST` | `/api/auth/register` | Admin | Create new user |
| `GET` | `/api/auth/users` | Admin | List users for impersonation dropdown |
| `POST` | `/api/query/ask` | Cookie | **Full 14-step NL-to-SQL pipeline** |
| `POST` | `/api/query/clear-history` | Cookie | Reset conversation memory (on role switch) |
| `GET` | `/api/query/cache-stats` | Admin | L1/L2 cache statistics |
| `GET` | `/api/query/roles` | No | Demo roles for role switcher |
| `GET` | `/api/audit/stats` | Admin | Aggregate audit statistics |
| `GET` | `/api/audit/log` | Admin | Detailed audit entries (filterable) |

---

## Authentication System

Stateless JWT-based auth. Tokens stored in **httpOnly cookies** — never exposed to JavaScript.

### JWT Token Structure

Signed with **HS256** using `JWT_SECRET_KEY` (no fallback — app refuses to start without it).

| Claim | Example | Description |
|-------|---------|-------------|
| `sub` | `"demo_doctor"` | User's `external_id` |
| `user_id` | `1` | Database primary key |
| `display_name` | `"Dr. Sarah Chen"` | For UI display |
| `role` | `"physician"` | Role name for RBAC |
| `exp` | Unix timestamp | 8-hour expiry |

### Admin Impersonation

Admin can act as any user via `X-Impersonate` header. The auth dependency loads the impersonated user's profile from DB and sets `impersonated_by` for audit tracking. Frontend clears conversation history on role switch.

---

## Role-Based Access Control (RBAC)

| Role | `row_scope` | Allowed Tables | Denied Columns | PII |
|------|-------------|----------------|----------------|-----|
| **Physician** | own_patients | All clinical + financial | — | Yes |
| **Nurse** | department | Clinical tables only | Cost columns | No |
| **Billing** | all | Financial + patients + encounters | Clinical tables blocked; clinical queries denied via keyword guard + LLM prompt | No |
| **Researcher** | aggregate_only | All clinical + financial | PII columns | No |
| **Admin** | all | All tables | — | Yes |

The `RoleContext` flows through every pipeline step:
1. **System prompt** — `to_prompt_constraints()` generates LLM-readable access rules
2. **SQL validator** — Checks table/column access against allowed lists
3. **SQL rewriter** — Injects mandatory WHERE/EXISTS filters
4. **Sensitivity classifier** — PII access check for RED classification
5. **Audit log** — Records role, scope, and impersonation context

---

## Security — Defense in Depth

| Layer | Protection |
|-------|-----------|
| **Layer 1: Authentication** | JWT in httpOnly cookie, bcrypt passwords |
| **Layer 2: Content Safety** | Azure AI screens input before LLM and output after LLM |
| **Layer 3: Sensitivity Gate** | RED queries blocked before SQL generation even starts |
| **Layer 4: Billing Clinical Guard** | Regex keyword detection denies clinical queries for billing role pre-SQL-generation |
| **Layer 5: LLM Prompt** | Role constraints injected into system prompt as mandatory rules; billing gets explicit financial-only instructions |
| **Layer 6: SQL Validation** | sqlglot AST parsing blocks mutations, system tables, denied columns |
| **Layer 7: SQL Rewriting** | Unconditional RBAC filter injection — bypasses prompt injection |
| **Layer 8: Read-only DB** | `q2i_readonly` user has only `db_datareader` — mutations rejected at DB level |
| **Layer 9: Audit Logging** | Every query attempt logged with user, role, SQL, timing, safety scores |

---

## Azure Services (7)

- Azure SQL Database — Synthea data + RBAC tables + audit log
- Azure OpenAI (gpt-4o-mini) — SQL generation, explanation, visualization, suggestions, sensitivity classification
- Azure AI Content Safety — Input/output screening
- Azure Cache for Redis — L2 distributed query result cache (TLS, 1hr TTL, role+scope-aware keys)
- Key Vault — Secret storage
- Application Insights — Monitoring
- Log Analytics Workspace — Centralized logging

---

## Local Development

**Prerequisites**
- Node.js 20+ (use `nvm use 22`)
- Python 3.11+
- ODBC Driver 18 for SQL Server

**Backend**
```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000/docs
```

**Frontend**
```bash
cd frontend
nvm use 22
npm install
npm run dev
# → http://localhost:5173
```

**Environment variables** — create `.env` at the repo root:
```
AZURE_SQL_CONNECTION_STRING=...
AZURE_SQL_READONLY_CONNECTION_STRING=...
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-12-01-preview
CONTENT_SAFETY_ENDPOINT=...          # optional — degrades gracefully
CONTENT_SAFETY_KEY=...               # optional — degrades gracefully
REDIS_URL=rediss://...               # optional — Azure Cache for Redis TLS URL; L1-only fallback if absent
FRONTEND_URL=http://localhost:5173
JWT_SECRET_KEY=...   # generate: python3 -c "import secrets; print(secrets.token_hex(32))"
```

### Demo Credentials

| Username | Password | Role |
|----------|----------|------|
| `demo_admin` | `admin123` | Admin — full access |
| `demo_doctor` | `doctor123` | Physician — own patients |
| `demo_nurse` | `nurse123` | Nurse — department |
| `demo_billing` | `billing123` | Billing — financial only |
| `demo_researcher` | `researcher123` | Researcher — aggregate only |

---

## Frontend Components (Day 4)

| Component | File | Purpose |
|-----------|------|---------|
| **ChartRenderer** | `components/ChartRenderer.tsx` | Renders Recharts bar/line/pie/scatter from backend JSON spec; converts string values to numbers |
| **ResultsTable** | `components/ResultsTable.tsx` | Sortable data table with smart numeric/string sort, sticky headers, 50-row cap |
| **RAIBanner** | `components/RAIBanner.tsx` | Horizontal status bar: sensitivity dot, confidence pill, role/scope, timing, RBAC/impersonation flags |
| **AuditDashboard** | `components/AuditDashboard.tsx` | Admin panel: total queries, denial rate, RBAC mods, latency, role breakdown, recent denials |

### UI Layout Order (per query result)
1. RAI Banner (first thing visible — Responsible AI at a glance)
2. Answer card (natural language explanation)
3. Bias alert / sensitivity advisory (if applicable)
4. Visualization chart (auto-generated bar/line/pie/scatter)
5. Results table (sortable raw data)
6. SQL transparency (collapsed by default, expandable)
7. Warnings

---

## Scoring Alignment

| Criteria (25% each) | Coverage |
|---------------------|----------|
| **Responsible AI** | Sensitivity classifier (Privacy & Security), bias detector (Fairness), audit log (Accountability), content safety (Reliability & Safety), SQL transparency (Transparency), RBAC (Inclusiveness) |
| **Innovation** | Conversational memory with follow-ups, proactive suggestion chips, bias detection, two-tier sensitivity classification, auto-visualization engine, billing clinical guard |
| **Azure Services** | SQL Database, OpenAI, Content Safety, Cache for Redis, Key Vault, App Insights, Log Analytics |
| **Functionality** | 14-step pipeline, 5 distinct roles, 8-layer SQL validation, 9-layer defense-in-depth security, auto-visualization, sortable tables, RAI status bar |

---

> AI-generated analysis of synthetic data (Synthea). Results should be verified by qualified professionals.
