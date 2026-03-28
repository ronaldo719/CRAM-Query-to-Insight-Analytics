# CRAM — Query-to-Insight Analytics Engine

**Microsoft Innovation Challenge 2026**

CRAM is an agentic analytics system that converts natural language questions into validated, role-scoped SQL queries against a clinical/financial database. It demonstrates Microsoft's Responsible AI principles through a 14-step pipeline with defense-in-depth security, sensitivity classification, bias detection, and full audit transparency.

---

## Table of Contents

- [Architecture](#architecture)
- [Azure Services](#azure-services)
- [Responsible AI Principles](#responsible-ai-principles)
- [Setup & Deployment](#setup--deployment)
- [Local Development](#local-development)
- [API Reference](#api-reference)
- [Role-Based Access Control](#role-based-access-control)
- [Security Model](#security-model)
- [Demo Credentials](#demo-credentials)
- [Next Steps](#next-steps)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT TIER                                  │
│              Azure Static Web Apps (React + TypeScript)             │
│   LoginPage  │  App.tsx  │  RAIBanner  │  ChartRenderer  │  Audit  │
└────────────────────────────┬────────────────────────────────────────┘
                             │  HTTPS / httpOnly JWT cookie
┌────────────────────────────▼────────────────────────────────────────┐
│                        API TIER                                     │
│                  Azure App Service (FastAPI)                        │
│                                                                     │
│   /api/auth/*   │   /api/query/ask   │   /api/audit/*              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              14-Step Query Pipeline                          │  │
│  │                                                              │  │
│  │  RBAC Load → Billing Guard → Content Safety Screen →        │  │
│  │  Sensitivity Classify → SQL Generate → Validate (3×) →      │  │
│  │  RBAC Rewrite → Execute → Bias Detect → Explain →           │  │
│  │  Output Safety → Viz Spec → Suggestions → Audit Log         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────┬──────────────┬──────────────┬──────────────┬────────────────┘
       │              │              │              │
┌──────▼──────┐ ┌─────▼──────┐ ┌────▼────┐ ┌──────▼──────────────┐
│  Azure SQL  │ │   Azure    │ │  Azure  │ │    Azure Cache      │
│  Database   │ │  OpenAI    │ │Content  │ │    for Redis        │
│             │ │  Service   │ │ Safety  │ │  (L2 Query Cache)   │
│ • Synthea   │ │            │ │         │ │                     │
│   clinical/ │ │ • SQL gen  │ │ • Input │ │ • Role+scope-aware  │
│   financial │ │ • Explain  │ │   scan  │ │   cache keys        │
│ • RBAC      │ │ • Viz spec │ │ • Output│ │ • 1hr TTL           │
│   tables    │ │ • Suggest  │ │   scan  │ │ • TLS (rediss://)   │
│ • Audit log │ │ • Classify │ │         │ │ • LRU L1 fallback   │
└─────────────┘ └────────────┘ └─────────┘ └─────────────────────┘

       ┌─────────────────────────────────────────────┐
       │           SECRETS & OBSERVABILITY           │
       │  Azure Key Vault  │  Azure App Insights     │
       └─────────────────────────────────────────────┘
```

### Query Pipeline — Step by Step

```
POST /api/query/ask { "question": "..." }
          │
          ▼
 1.  Load RBAC Context        app_users → app_roles → column_access
 1b. Billing Clinical Guard   Deny clinical queries for billing role (pre-SQL)
          │
          ▼
 2.  Content Safety Screen    Block harmful input before any processing
          │
          ▼
 3.  Sensitivity Classify     Rule-based → LLM fallback
                              GREEN: proceed | AMBER: advisory | RED: block
          │
          ▼
 4.  Generate SQL             Azure OpenAI: schema + role constraints + conversation history
          │
          ▼
 5.  Validate SQL             sqlglot AST, 8 layers, up to 3× self-correction
          │
          ▼
 6.  Rewrite with RBAC        CTE wrapper or inline WHERE injection (unconditional)
          │
          ▼
 7.  Execute SQL              Read-only connection, 30s timeout, 500-row cap
          │
          ▼
 8.  Bias Detection           Scan results for demographic disparities >20%
          │
          ▼
 9.  Generate Explanation     Azure OpenAI plain-language summary
          │
          ▼
 10. Screen Output            Azure Content Safety on generated explanation
          │
          ▼
 11. Visualization Spec       LLM-generated chart spec (bar/line/pie/scatter)
          │
          ▼
 12. Follow-up Suggestions    3 contextual questions via LLM
          │
          ▼
 13. Conversation Storage     Last 5 Q&A pairs per user session
          │
          ▼
 14. Audit Log                User, role, SQL, timing, sensitivity, safety scores
          │
          ▼
     JSON Response
```

### Project Structure

```
CRAM-Query-to-Insight-Analytics/
├── backend/
│   ├── app/
│   │   ├── main.py                      # FastAPI entry, CORS, router registration
│   │   ├── config.py                    # Settings + Azure OpenAI client factory
│   │   ├── dependencies/
│   │   │   └── auth.py                  # get_current_user, require_admin
│   │   ├── routers/
│   │   │   ├── auth.py                  # /api/auth/* endpoints
│   │   │   ├── query.py                 # /api/query/ask + /clear-history
│   │   │   └── audit.py                 # /api/audit/stats + /log (admin)
│   │   └── services/
│   │       ├── query_engine.py          # 14-step pipeline orchestrator
│   │       ├── rbac_service.py          # RoleContext loader from DB
│   │       ├── sql_validator.py         # 8-layer sqlglot AST validation
│   │       ├── sql_rewriter.py          # RBAC filter injection (CTE + inline)
│   │       ├── sensitivity_classifier.py# GREEN/AMBER/RED classification
│   │       ├── bias_detector.py         # Demographic disparity alerts
│   │       ├── conversation_manager.py  # Session memory + suggestions
│   │       ├── content_safety_service.py# Azure Content Safety screening
│   │       ├── cache_service.py         # Two-tier L1 in-memory + L2 Redis
│   │       └── auth_service.py          # JWT + bcrypt auth
│   ├── scripts/
│   │   ├── setup_database.py            # Schema + Synthea data loading
│   │   └── migrate_auth.py              # Password seeding
│   └── requirements.txt
└── frontend/
    └── src/
        ├── App.tsx                      # Main layout, query form, results
        ├── AuthContext.tsx              # JWT cookie session, impersonation
        ├── LoginPage.tsx                # Login form + demo quick-login
        └── components/
            ├── ChartRenderer.tsx        # Recharts auto-visualization engine
            ├── ResultsTable.tsx         # Sortable data table, sticky headers
            ├── RAIBanner.tsx            # Responsible AI status bar
            └── AuditDashboard.tsx       # Admin audit statistics panel
```

---

## Azure Services

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Azure SQL Database** | Hosts Synthea synthetic clinical/financial data, RBAC tables (`app_users`, `app_roles`, `app_role_table_access`, `app_role_column_access`), and `app_query_audit_log` | Two connection strings: full-access (admin) and read-only (`q2i_readonly` user with `db_datareader` only) |
| **Azure App Service** | Runs the FastAPI backend (Python 3.11+). Configured via environment variables from Key Vault references | Set `SCM_DO_BUILD_DURING_DEPLOYMENT=true`; startup command: `uvicorn app.main:app --host 0.0.0.0 --port 8000` |
| **Azure OpenAI Service** | Powers SQL generation, natural language explanation, visualization spec, follow-up suggestions, and sensitivity classification (LLM fallback) | Model: `gpt-4o-mini`; API version: `2024-12-01-preview`; set `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT` |
| **Azure Static Web Apps** | Hosts the React/TypeScript frontend with global CDN distribution | Build: `npm run build`; output: `dist/`; configure `VITE_API_URL` to point to App Service URL |
| **Azure Key Vault** | Stores all secrets: SQL connection strings, OpenAI key, Content Safety key, Redis password, JWT secret | App Service uses managed identity to retrieve secrets via Key Vault references in app settings |
| **Azure Cache for Redis** | L2 distributed query result cache shared across all backend instances. Role+scope-aware cache keys prevent cross-role result leakage | TLS URL (`rediss://`); set `REDIS_URL`; 1hr TTL; graceful L1-only degradation if unavailable |
| **Azure AI Content Safety** | Screens user input before LLM processing and screens generated output before returning to user. Blocks harmful content, prompt injection, hate speech | Set `CONTENT_SAFETY_ENDPOINT` and `CONTENT_SAFETY_KEY`; optional — service degrades gracefully if not configured |

---

## Responsible AI Principles

| Microsoft RAI Principle | Implementation | Where in Code |
|------------------------|----------------|---------------|
| **Fairness** | `BiasDetector` scans query results for demographic dimensions (race, gender, ethnicity, age group) paired with outcome measures. Flags disparities >20% with a contextual fairness notice and the magnitude of variation. | `services/bias_detector.py` → Step 8 of pipeline |
| **Reliability & Safety** | Azure Content Safety screens both input and output. SQL validator retries generation up to 3× with error feedback before failing. Read-only DB connection prevents mutations at the infrastructure level. | `services/content_safety_service.py`, `services/sql_validator.py` |
| **Privacy & Security** | `SensitivityClassifier` uses two-tier classification (rule-based + LLM fallback) to block queries targeting stigmatized conditions (HIV, substance abuse, mental health), PII fields (SSN, passport), or individual-level sensitive records. RED queries are blocked before SQL generation. | `services/sensitivity_classifier.py` → Step 3 of pipeline |
| **Inclusiveness** | Five distinct RBAC roles enforce appropriate data access for each user type. Physicians see own patients, nurses see department patients, researchers only receive aggregated results with k-anonymity enforced, billing is restricted to financial data. | `services/rbac_service.py`, `services/sql_rewriter.py` |
| **Transparency** | Every response includes the generated SQL and any RBAC modifications made by the rewriter, displayed in an expandable SQL transparency panel. The RAI banner shows sensitivity level, confidence, role, scope, and whether the result was RBAC-modified or impersonated. | `components/RAIBanner.tsx`, `components/ResultsTable.tsx`, `app/routers/query.py` |
| **Accountability** | Every query attempt (including blocked/denied queries) is written to `app_query_audit_log` with: user identity, role, impersonation context, question, generated SQL, sensitivity level, Content Safety scores, latency (ms), and denial reason. Admin audit dashboard surfaces aggregate statistics and denial breakdown. | `services/query_engine.py` Step 14, `routers/audit.py`, `components/AuditDashboard.tsx` |

---

## Setup & Deployment

### Prerequisites

- Azure subscription with access to: SQL Database, App Service, OpenAI Service, Static Web Apps, Key Vault, Cache for Redis, AI Content Safety
- Python 3.11+
- Node.js 22+ (`nvm use 22`)
- [ODBC Driver 18 for SQL Server](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server)

### 1. Database Setup

1. Create an Azure SQL Database and run the setup script to load Synthea synthetic data:
   ```bash
   cd backend
   source venv/bin/activate
   pip install -r requirements.txt
   python scripts/setup_database.py
   python scripts/migrate_auth.py
   ```
2. Create a read-only SQL user:
   ```sql
   CREATE USER q2i_readonly WITH PASSWORD = '<password>';
   ALTER ROLE db_datareader ADD MEMBER q2i_readonly;
   ```

### 2. Key Vault

Store the following secrets in Azure Key Vault:

| Secret Name | Value |
|------------|-------|
| `sql-connection-string` | Full-access connection string (admin operations) |
| `sql-readonly-connection-string` | Read-only connection string (`q2i_readonly` user) |
| `openai-key` | Azure OpenAI API key |
| `content-safety-key` | Azure AI Content Safety key (optional) |
| `redis-url` | Redis TLS URL (`rediss://...`) (optional) |
| `jwt-secret-key` | 32-byte hex secret — generate: `python3 -c "import secrets; print(secrets.token_hex(32))"` |

### 3. Backend — Azure App Service

1. Create an App Service (Python 3.11, Linux).
2. Grant the App Service managed identity **Key Vault Secrets User** role on the Key Vault.
3. Add the following application settings (using Key Vault references):

```
AZURE_SQL_CONNECTION_STRING          @Microsoft.KeyVault(SecretUri=...)
AZURE_SQL_READONLY_CONNECTION_STRING @Microsoft.KeyVault(SecretUri=...)
AZURE_OPENAI_ENDPOINT                https://<resource>.openai.azure.com/
AZURE_OPENAI_KEY                     @Microsoft.KeyVault(SecretUri=...)
AZURE_OPENAI_DEPLOYMENT              gpt-4o-mini
AZURE_OPENAI_API_VERSION             2024-12-01-preview
CONTENT_SAFETY_ENDPOINT              https://<resource>.cognitiveservices.azure.com/
CONTENT_SAFETY_KEY                   @Microsoft.KeyVault(SecretUri=...)
REDIS_URL                            @Microsoft.KeyVault(SecretUri=...)
JWT_SECRET_KEY                       @Microsoft.KeyVault(SecretUri=...)
FRONTEND_URL                         https://<your-static-web-app>.azurestaticapps.net
SCM_DO_BUILD_DURING_DEPLOYMENT       true
```

4. Set startup command:
   ```
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

5. Deploy from the `backend/` directory:
   ```bash
   cd backend
   zip -r ../backend.zip . --exclude "venv/*" --exclude "__pycache__/*"
   az webapp deploy --resource-group <rg> --name <app-name> --src-path ../backend.zip
   ```

### 4. Frontend — Azure Static Web Apps

1. Create a Static Web App linked to the repository, or deploy manually:
   ```bash
   cd frontend
   nvm use 22
   npm install
   VITE_API_URL=https://<app-service-name>.azurewebsites.net npm run build
   az staticwebapp deploy --app-name <static-app-name> --source ./dist
   ```

2. Set the CORS `FRONTEND_URL` environment variable on App Service to match the Static Web Apps URL.

---

## Local Development

**Environment variables** — create `.env` at `CRAM-Query-to-Insight-Analytics/`:

```bash
AZURE_SQL_CONNECTION_STRING=Driver={ODBC Driver 18 for SQL Server};Server=...
AZURE_SQL_READONLY_CONNECTION_STRING=Driver={ODBC Driver 18 for SQL Server};Server=...;UID=q2i_readonly;...
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-12-01-preview
CONTENT_SAFETY_ENDPOINT=https://<resource>.cognitiveservices.azure.com/  # optional
CONTENT_SAFETY_KEY=<key>                                                  # optional
REDIS_URL=rediss://<host>:6380/<db>?password=<key>                       # optional
JWT_SECRET_KEY=<32-byte hex>
FRONTEND_URL=http://localhost:5173
```

**Backend:**
```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# API docs: http://localhost:8000/docs
```

**Frontend:**
```bash
cd frontend
nvm use 22
npm install
npm run dev
# UI: http://localhost:5173
```

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check |
| `POST` | `/api/auth/login` | None | Authenticate, set `q2i_token` httpOnly cookie (8hr) |
| `POST` | `/api/auth/logout` | None | Clear session cookie |
| `GET` | `/api/auth/me` | Cookie | Current user; respects `X-Impersonate` header for Admin |
| `POST` | `/api/auth/register` | Admin | Create new user |
| `GET` | `/api/auth/users` | Admin | List users for impersonation dropdown |
| `POST` | `/api/query/ask` | Cookie | **Main pipeline** — full 14-step NL-to-SQL |
| `POST` | `/api/query/clear-history` | Cookie | Reset conversation memory (call on role switch) |
| `GET` | `/api/query/cache-stats` | Admin | L1/L2 cache statistics |
| `GET` | `/api/query/roles` | None | Available roles for role switcher |
| `GET` | `/api/audit/stats` | Admin | Aggregate audit statistics |
| `GET` | `/api/audit/log` | Admin | Detailed audit entries |

### Query Request / Response

**Request:**
```json
POST /api/query/ask
{
  "question": "What is the average healthcare cost by race?"
}
```

**Response:**
```json
{
  "answer": "Average healthcare expenses vary significantly by race...",
  "sql": "SELECT RACE, AVG(HEALTHCARE_EXPENSES) as avg_cost FROM ...",
  "executed_sql": "SELECT rbac_outer.* FROM (...) rbac_outer WHERE ...",
  "data": [...],
  "sensitivity": "AMBER",
  "sensitivity_reason": "Demographic correlation query",
  "bias_alert": "avg_cost varies by 95% across RACE groups...",
  "visualization": { "type": "bar", "x_column": "RACE", "y_column": "avg_cost" },
  "suggestions": ["Break down by age group?", "Compare to national average?", "..."],
  "rbac_modified": true,
  "from_cache": false,
  "latency_ms": 1842
}
```

---

## Role-Based Access Control

| Role | Row Scope | Allowed Tables | Restrictions |
|------|-----------|----------------|--------------|
| **Physician** | `own_patients` — encounters filtered by `PROVIDER = '{id}'` | All clinical + financial | None |
| **Nurse** | `department` — encounters filtered by `ORGANIZATION = '{id}'` | Clinical tables only | Cost columns denied |
| **Billing** | `all` | Financial tables + patients + encounters | Clinical queries denied via keyword guard + LLM prompt; clinical column access denied |
| **Researcher** | `aggregate_only` — GROUP BY required; `HAVING COUNT(*) >= 5` injected | All clinical + financial | PII columns denied; individual-level queries blocked |
| **Admin** | `all` | All tables | Can impersonate any user via `X-Impersonate` header |

### RBAC Rewriting Strategy

**Non-aggregate queries** use a CTE wrapper:
```sql
SELECT rbac_outer.* FROM (
    <original LLM-generated query>
) rbac_outer
WHERE EXISTS (
    SELECT 1 FROM dbo.encounters rbac_enc
    WHERE rbac_enc.PATIENT = rbac_outer.Id
      AND rbac_enc.PROVIDER = 'e5a3f7ff-...'
)
```

**Aggregate queries (GROUP BY)** receive inline EXISTS injection into the WHERE clause. Researcher queries additionally receive `HAVING COUNT(*) >= 5` for k-anonymity enforcement.

---

## Security Model

| Layer | Control | Mechanism |
|-------|---------|-----------|
| **1 — Authentication** | Stateless JWT session | HS256 JWT in httpOnly cookie; 8hr expiry; bcrypt passwords |
| **2 — Input Safety** | Block harmful prompts | Azure Content Safety before any LLM call |
| **3 — Sensitivity Gate** | Block privacy-sensitive queries | RED classification stops pipeline before SQL generation |
| **4 — Billing Clinical Guard** | Prevent clinical data access for billing role | Regex keyword detection + LLM system prompt constraints; denied pre-SQL |
| **5 — LLM Prompt Constraints** | Role rules in system prompt | `to_prompt_constraints()` injects mandatory access rules per role |
| **6 — SQL Validation** | Block dangerous SQL patterns | sqlglot AST: 8 layers covering mutations, system tables, denied tables/columns, aggregate enforcement |
| **7 — SQL Rewriting** | Enforce row-level access unconditionally | RBAC filters injected post-generation regardless of what the LLM produced |
| **8 — Read-only Connection** | Prevent DB mutations | `q2i_readonly` user has `db_datareader` only; mutations rejected at DB level |
| **9 — Output Safety** | Block harmful LLM output | Azure Content Safety screens generated explanation before returning to client |
| **10 — Audit Log** | Full accountability trail | Every attempt logged: user, role, SQL, timing, sensitivity, safety scores, denial reason |

---

## SQL Validation — 8 Layers

| Layer | Check | Action on Failure |
|-------|-------|-------------------|
| 1 | **Parse** | Reject unparseable SQL; retry with error feedback |
| 2 | **No mutations** | Block INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, GRANT, TRUNCATE |
| 3 | **No system tables** | Block `sys.*`, `information_schema.*`, `app_users`, `app_roles`, auth tables |
| 4 | **Table-level access** | Only allow tables in role's `allowed_tables` list |
| 5 | **Column-level access** | Block columns in role's deny list (PII, cost columns per role) |
| 6 | **Aggregate enforcement** | Researcher role: require GROUP BY + aggregate function |
| 7 | **TOP injection** | Add `TOP 500` if absent; handles `SELECT DISTINCT` correctly |
| 8 | **Row scope check** | Warn if provider/org filter missing (rewriter will inject it) |

---

## Two-Tier Query Cache

| Tier | Backend | Capacity | Scope |
|------|---------|----------|-------|
| **L1** | Python `dict` (in-process, LRU) | 200 entries | Per server process |
| **L2** | Azure Cache for Redis (TLS) | Unlimited | Shared across all processes/instances |

Cache key format: `q2i:<SHA256(question.lower() + role + row_scope)[:16]>`

**Behavior:**
- **Hit** — Returns instantly, skips all 14 pipeline steps. Fresh suggestions still generated. Response includes `"from_cache": true`.
- **Miss** — Full pipeline runs; result stored in L1 + L2 on completion (non-denied, non-empty results only).
- **Eligibility** — Standalone queries only; follow-ups with conversation history always run fresh.
- **TTL** — 3600s on both tiers. Redis handles L2 expiration via `SETEX`.
- **Degradation** — Redis unavailable: logs warning, continues L1-only; pipeline never blocked.

---

## Sensitivity Classification

**Tier 1 — Rule-based (zero API calls):**

| Pattern | Level |
|---------|-------|
| Stigmatized conditions (HIV, substance abuse, mental health) + individual access | RED |
| PII fields (SSN, passport, drivers license) without PII permission | RED |
| Demographic correlations (by race, by ethnicity, disparities) | AMBER |
| Standard analytics (count, total, average, top N) | GREEN |

**Tier 2 — LLM classification:** Single API call for queries not matched by rules.

| Level | UI | Behavior |
|-------|----|----------|
| GREEN | Green dot | Pipeline proceeds silently |
| AMBER | Amber dot + advisory notice | Pipeline proceeds with contextual warning shown |
| RED | Red dot + blocked message | Pipeline halted; denial reason returned |

---

## Demo Credentials

| Username | Password | Role | Data Scope |
|----------|----------|------|------------|
| `demo_admin` | `admin123` | Admin | Full access + user impersonation |
| `demo_doctor` | `doctor123` | Physician | Own patients only |
| `demo_nurse` | `nurse123` | Nurse | Department patients, no costs |
| `demo_billing` | `billing123` | Billing | Financial data only |
| `demo_researcher` | `researcher123` | Researcher | Aggregate only, k-anonymity enforced |

---

## Database Schema

Synthea synthetic health and financial data:

**Clinical:** `patients`, `encounters`, `conditions`, `medications`, `observations`, `procedures`, `immunizations`, `allergies`, `careplans`, `devices`, `supplies`, `imaging_studies`

**Financial:** `claims`, `claims_transactions`, `payer_transitions`

**RBAC / App:** `app_users`, `app_roles`, `app_role_table_access`, `app_role_column_access`, `app_query_audit_log`

---

---

## Next Steps

### Production Hardening

| Area | Item |
|------|------|
| **Infrastructure** | Move from App Service to Azure Container Apps for horizontal autoscaling; add Azure Front Door for global load balancing and WAF |
| **Database** | Enable Azure SQL Always Encrypted for PHI columns at rest; configure geo-replication for disaster recovery |
| **Secrets** | Rotate all Key Vault secrets on a schedule via Azure Key Vault managed rotation policies |
| **Observability** | Wire structured logs from the 14-step pipeline into Azure Application Insights with custom dimensions (role, sensitivity, latency per step); build an Azure Monitor workbook for SLA tracking |
| **CI/CD** | Add GitHub Actions pipelines for backend (pytest, mypy, safety scan) and frontend (ESLint, Vitest, build check) with required status checks before merge |

### Security & Compliance

| Area | Item |
|------|------|
| **Authentication** | Replace demo credential system with Azure Entra ID (formerly Azure AD) SSO and group-to-role mapping; add MFA enforcement |
| **Network isolation** | Deploy App Service and SQL Database into an Azure Virtual Network; restrict public endpoints; route Redis traffic over Private Endpoint |
| **Penetration testing** | Conduct structured prompt injection testing against all five roles; validate that RBAC rewriting cannot be bypassed via nested subqueries or CTEs |
| **Compliance** | Engage a qualified assessor for HIPAA Business Associate Agreement if connecting to real EHR data; document data flow for PHI handling |
| **SQL validation** | Extend the sqlglot validator to cover lateral joins, window function abuse, and time-based blind injection patterns |

### Feature Roadmap

| Priority | Feature | Description |
|----------|---------|-------------|
| High | **Real EHR connector** | Replace Synthea synthetic data with a FHIR R4 adapter (Azure Health Data Services) for production clinical data |
| High | **Persistent conversation history** | Move session memory from in-process dict to Azure Cosmos DB so conversations survive restarts and scale across instances |
| Medium | **Scheduled reports** | Allow users to save a query and receive results on a schedule via Azure Logic Apps + email/Teams notification |
| Medium | **Export & sharing** | Add CSV/Excel export for result tables and a shareable link (with RBAC-aware access control on the shared view) |
| Medium | **Query history UI** | Surface the audit log to each user as their own query history with the ability to replay or refine previous questions |
| Low | **Multi-model support** | Abstract the LLM layer to support GPT-4o, GPT-4 Turbo, and fine-tuned domain models; A/B test SQL generation quality |
| Low | **Natural language alerts** | Let users subscribe to threshold-based alerts ("notify me when average wait time exceeds 30 minutes") backed by Azure Monitor |

### Responsible AI Maturity

| Item | Description |
|------|-------------|
| **Red team evaluation** | Systematic adversarial testing of sensitivity classifier and billing clinical guard for edge cases and bypass attempts |
| **Bias audit** | Quarterly review of bias detection thresholds using domain experts; adjust the 20% disparity threshold based on clinical context |
| **Explainability panel** | Expand the SQL transparency panel to show which RBAC filter was injected, which sensitivity rule fired, and why the visualization type was selected |
| **Fairness dashboard** | Aggregate bias alerts across queries over time into an admin-visible fairness trend report |
| **RAI Impact Assessment** | Complete a formal Microsoft RAI Impact Assessment before connecting to production patient data |

---

> This system analyzes Synthea synthetic data. Results are not based on real patient records and should not be used for clinical or financial decisions. All AI-generated analysis should be verified by qualified professionals.
