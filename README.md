# CRAM — Query-to-Insight Analytics Engine
**Microsoft Innovation Challenge 2026**

An agentic analytics engineer that converts natural language questions into validated, RBAC-filtered SQL queries against a clinical/financial database, then explains the results in plain language.

---

## Day 2 Checkpoint ✅

### What's Built

**Full NL-to-SQL Pipeline** — A single `POST /api/query/ask` call runs the complete pipeline:

```
JWT auth → RBAC context → Content Safety → SQL generation →
sqlglot validation → RBAC rewriting → execution → explanation → audit
```

**Backend Services (FastAPI)**
- `app/services/rbac_service.py` — Loads complete role context from DB (`app_users → app_roles → app_role_column_access`)
- `app/services/content_safety_service.py` — Azure AI Content Safety screening (input + output) with graceful degradation
- `app/services/query_engine.py` — Pipeline orchestrator: 9-step execution with 3-retry self-correction loop
- `app/services/sql_validator.py` — 8-layer SQL validation using sqlglot AST parsing
- `app/services/sql_rewriter.py` — Defense-in-depth row-level filter injection via subquery wrapping
- `app/routers/query.py` — Updated to delegate to `QueryEngine` (replaces Day 1 stub)

**Frontend (React + Vite)**
- `src/App.tsx` — Full query UI with results table, SQL transparency panel, visualization
- `src/AuthContext.tsx` — Session management, login/logout, `authFetch` wrapper, impersonation

**Infrastructure**
- Azure SQL Database (`synthea-health`) — 18 Synthea clinical/financial tables + RBAC tables + audit log
- Azure OpenAI (`gpt-4o-mini`) — SQL generation, result explanation, and visualization spec generation
- Azure AI Content Safety — Input/output screening (degrades gracefully when not configured)
- Read-only DB user (`q2i_readonly`) — Defense-in-depth: even if SQL contains mutations, the database rejects them

---

## Query Pipeline — How It Works

```
                    ┌─────────────────────────────────────────────┐
                    │            POST /api/query/ask              │
                    │         { question, history? }              │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Step 1: Load RBAC Context                  │
                    │  rbac_service.get_role_context(external_id) │
                    │  → app_users → app_roles → column_access    │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Step 2: Content Safety Screening           │
                    │  Screen user's question for harmful content │
                    │  → Block or allow                           │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Step 3: Generate SQL (Azure OpenAI)        │
                    │  System prompt = schema + role constraints   │
                    │  + few-shot examples + conversation history  │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Step 4: Validate SQL (sqlglot)             │
                    │  8 layers: parse → no mutations → no system │
                    │  tables → table access → column access →    │
                    │  aggregate enforcement → TOP injection →    │
                    │  row scope check                            │
                    │  ↻ If invalid, retry up to 3× with error   │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Step 5: Rewrite SQL with RBAC Filters      │
                    │  Wrap in subquery + EXISTS filter for        │
                    │  provider/org/k-anonymity enforcement       │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Step 6: Execute SQL (read-only connection)  │
                    │  q2i_readonly user, 30s timeout, 500 row cap│
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Step 7: Generate Explanation (Azure OpenAI) │
                    │  Plain-language summary of results           │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Step 8: Screen Output (Content Safety)      │
                    │  Catch harmful content in LLM explanations   │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Step 9: Generate Visualization Spec         │
                    │  LLM recommends chart type + formats data    │
                    │  for Recharts (bar/line/pie/scatter/table)   │
                    └──────────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │  Audit Log: Write everything to              │
                    │  dbo.app_query_audit_log                     │
                    └─────────────────────────────────────────────┘
```

---

## SQL Validation — 8 Layers

The `SQLValidator` parses every LLM-generated query with **sqlglot** and enforces:

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

Even if the LLM correctly includes RBAC filters, the rewriter **unconditionally** wraps the query with access controls. This prevents prompt injection from bypassing row-level security.

**Strategy:** Wrap the LLM's SQL in a subquery and add an `EXISTS` filter:

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

| Scope | Filter |
|-------|--------|
| `own_patients` | `encounters.PROVIDER = '{provider_id}'` |
| `department` | `encounters.ORGANIZATION = '{organization_id}'` |
| `aggregate_only` | Injects `HAVING COUNT(*) >= 5` for k-anonymity |
| `all` | No rewriting needed |

The rewriter auto-detects the patient column name (`Id` vs `PATIENT`) from the inner query's SELECT clause.

---

## Content Safety Integration

Azure AI Content Safety screens text at **two points** in the pipeline:

1. **Before the LLM** — Block harmful user questions (prompt injection, hate, violence, etc.)
2. **After the LLM** — Catch harmful content in generated explanations

**Graceful degradation:** If Content Safety is not configured (missing endpoint/key), the service logs a warning and allows requests through. This prevents breakage during local development.

| Category | Severity 0 | Severity 2+ |
|----------|------------|-------------|
| Hate | Safe | Blocked |
| Violence | Safe | Blocked |
| Sexual | Safe | Blocked |
| Self-harm | Safe | Blocked |

---

## Verified Test Scenarios

| # | Role | Query | Expected | Result |
|---|------|-------|----------|--------|
| 1 | **Admin** | "How many patients by gender?" | Full results + bar chart | ✅ 180 F, 159 M returned |
| 2 | **Doctor** | "Show me my patients with diabetes" | Own patients only, CTE wrapper | ✅ 3 patients, provider filter in `executed_sql` |
| 3 | **Billing** | "Patients with diabetes and medications" | Denied — clinical tables | ✅ `conditions` and `medications` blocked |
| 4a | **Researcher** | "Count conditions by type" | Aggregate with k-anonymity | ✅ 151 rows, `HAVING COUNT(*) >= 5` |
| 4b | **Researcher** | "Show me patient names" | Denied — individual records | ✅ LLM refused, aggregate-only constraint |
| 5 | **Nurse** | "What are encounter costs?" | Denied — cost columns | ✅ Claims table not in allowed tables |

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
| `POST` | `/api/query/ask` | Cookie | **Full NL-to-SQL pipeline** |
| `GET` | `/api/query/roles` | No | Demo roles for role switcher |

---

## Authentication System

The app uses stateless JWT-based authentication. Tokens are stored in **httpOnly cookies** — never exposed to JavaScript.

### Login Flow

```
Browser                         FastAPI Backend                    Azure SQL
  │                                    │                               │
  │── POST /api/auth/login ──────────> │                               │
  │   { username, password }           │── SELECT user + bcrypt hash ->│
  │                                    │<─ row ─────────────────────── │
  │                                    │   verify_password(plain, hash) │
  │                                    │   create_access_token(payload) │
  │<─ 200 { user: {...} } ────────────│
  │   Set-Cookie: q2i_token=<jwt>;    │
  │   HttpOnly; Secure; SameSite=Lax  │
```

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

Admin can act as any user via `X-Impersonate` header. The auth dependency loads the impersonated user's profile from DB and sets `impersonated_by` for audit tracking.

---

## Role-Based Access Control (RBAC)

| Role | `row_scope` | Allowed Tables | Denied Columns | PII |
|------|-------------|----------------|----------------|-----|
| **Physician** | own_patients | All clinical + financial | — | ✅ |
| **Nurse** | department | Clinical tables only | Cost columns | ❌ |
| **Billing** | all | Financial + patients + encounters | Clinical tables blocked | ❌ |
| **Researcher** | aggregate_only | All clinical + financial | PII columns | ❌ |
| **Admin** | all | All tables | — | ✅ |

The `RoleContext` object flows through every pipeline step:
1. **System prompt** — `to_prompt_constraints()` generates LLM-readable access rules
2. **SQL validator** — Checks table/column access against allowed lists
3. **SQL rewriter** — Injects mandatory WHERE/EXISTS filters
4. **Audit log** — Records role, scope, and impersonation context

---

## Project Structure

```
CRAM-Query-to-Insight-Analytics/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                       # FastAPI entry point, CORS config
│   │   ├── config.py                     # Settings + OpenAI client factory
│   │   ├── dependencies/
│   │   │   └── auth.py                   # get_current_user, require_admin
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py                   # /api/auth/* endpoints
│   │   │   └── query.py                  # /api/query/ask → QueryEngine
│   │   └── services/
│   │       ├── __init__.py
│   │       ├── auth_service.py           # bcrypt hashing, JWT, DB auth
│   │       ├── rbac_service.py           # RoleContext loader from DB
│   │       ├── content_safety_service.py # Azure Content Safety screening
│   │       ├── sql_validator.py          # 8-layer sqlglot validation
│   │       ├── sql_rewriter.py           # Subquery RBAC filter injection
│   │       └── query_engine.py           # Pipeline orchestrator (9 steps)
│   ├── scripts/                          # gitignored — setup/migration
│   │   ├── setup_database.py
│   │   └── migrate_auth.py
│   ├── requirements.txt
│   └── test_openai.py
├── frontend/
│   ├── src/
│   │   ├── App.tsx                       # Query UI + results + visualization
│   │   ├── AuthContext.tsx               # Session state, authFetch, impersonation
│   │   ├── LoginPage.tsx                 # Login form + demo quick-login
│   │   ├── main.jsx
│   │   └── index.css
│   ├── tsconfig.json
│   └── package.json
├── .env                                  # gitignored — secrets
└── .gitignore
```

---

## Local Development

**Prerequisites**
- Node.js 20+ (use `nvm use 20`)
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
nvm use 20
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
FRONTEND_URL=http://localhost:5173
JWT_SECRET_KEY=...   # generate: python3 -c "import secrets; print(secrets.token_hex(32))"
```

### Testing the Pipeline

1. Open Swagger UI at `http://localhost:8000/docs`
2. `POST /api/auth/login` with `{"username": "demo_admin", "password": "admin123"}`
3. `POST /api/query/ask` with `{"question": "What are the top 10 most common conditions?"}`
4. Test RBAC by logging in as different users (e.g., `demo_billing` / `billing123`)

---

## Security — Defense in Depth

| Layer | Protection |
|-------|-----------|
| **Layer 1: Authentication** | JWT in httpOnly cookie, bcrypt passwords, no token in response body |
| **Layer 2: Content Safety** | Azure AI screens input before LLM and output after LLM |
| **Layer 3: LLM Prompt** | Role constraints injected into system prompt as mandatory rules |
| **Layer 4: SQL Validation** | sqlglot AST parsing blocks mutations, system tables, denied columns |
| **Layer 5: SQL Rewriting** | Unconditional subquery wrapping — bypasses prompt injection |
| **Layer 6: Read-only DB** | `q2i_readonly` user has only `db_datareader` — mutations rejected at DB level |
| **Layer 7: Audit Logging** | Every query attempt logged with user, role, SQL, timing, safety scores |

---

## Azure Services (6)

- ✅ Azure SQL Database — Synthea data + RBAC tables + audit log
- ✅ Azure OpenAI (gpt-4o-mini) — SQL generation, explanation, visualization
- ✅ Azure AI Content Safety — Input/output screening
- ✅ Key Vault — Secret storage
- ✅ Application Insights — Monitoring
- ✅ Log Analytics Workspace — Centralized logging

---

## Day 3 — Planned (Responsible AI + Innovation)

- Auto-visualization: bar/line/pie chart rendering with Recharts
- Split `App.tsx` into components: `QueryInput`, `SQLPanel`, `ResultsTable`, `VisualizationPanel`
- Tailwind CSS + Lucide React icons
- Sensitivity classification (green/amber/red)
- Proactive follow-up question suggestions
- Approval workflow for sensitive queries
- Audit log viewer page

---

> AI-generated analysis of synthetic data (Synthea). Results should be verified by qualified professionals.
