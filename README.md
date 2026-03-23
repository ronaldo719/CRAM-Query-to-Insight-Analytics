# CRAM — Query-to-Insight Analytics Engine
**Microsoft Innovation Challenge 2026**

An agentic analytics engineer that converts natural language questions into validated, RBAC-filtered SQL queries against a clinical/financial database, then explains the results in plain language.

---

## Day 1 Checkpoint ✅

### What's Built

**Backend (FastAPI)**
- `app/main.py` — FastAPI entry point with CORS, health check, root endpoint
- `app/config.py` — Centralized settings + Azure OpenAI client factory (`lru_cache` singleton)
- `app/routers/query.py` — `/api/query/ask` and `/api/query/roles` endpoints

**Frontend (React + Vite)**
- `src/App.tsx` — Single-component Day 1 scaffold: role switcher, starter questions, query input, results panel with SQL transparency section

**Infrastructure**
- Azure SQL Database (`synthea-health`) — 18 Synthea clinical/financial tables loaded via `bcp`
- Azure OpenAI (`gpt-4o-mini`) — Connected and returning SQL generation responses
- `.gitignore` — Protects `.env`, `data/`, and `backend/scripts/` from being committed

---

### Verified Endpoints

| Endpoint | Method | Status |
|---|---|---|
| `/health` | GET | ✅ `{"status":"healthy","service":"query-to-insight-backend","version":"1.0.0"}` |
| `/api/query/roles` | GET | ✅ Returns 5 demo roles |
| `/api/query/ask` | POST | ✅ Calls Azure OpenAI, returns generated SQL + role context |

### Demo Roles

| ID | Name | Access |
|---|---|---|
| `demo_doctor` | Dr. Sarah Chen | Physician — own patients, full clinical |
| `demo_nurse` | James Rodriguez, RN | Department patients, clinical only |
| `demo_billing` | Maria Thompson | All patients, financial only |
| `demo_researcher` | Dr. Alex Kumar | Aggregate only, no PII |
| `demo_admin` | System Admin | Full access |

---

### Project Structure

```
CRAM-Query-to-Insight-Analytics/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI entry point
│   │   ├── config.py            # Settings + OpenAI client factory
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   └── query.py         # /api/query/ask and /api/query/roles
│   │   └── services/
│   │       └── __init__.py      # Day 2: rbac_service.py, sql_validator.py
│   ├── scripts/                 # gitignored — contains credentials
│   ├── requirements.txt
│   └── test_openai.py
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Full Day 1 UI scaffold
│   │   ├── main.jsx
│   │   └── index.css
│   ├── tsconfig.json
│   └── package.json
├── .env                         # gitignored — actual secrets
└── .gitignore
```

---

### Local Development

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

**Environment variables** — create `.env` at the repo root and fill in:
```
AZURE_SQL_CONNECTION_STRING=...
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-12-01-preview
FRONTEND_URL=http://localhost:5173
```

---

### Azure Services (6)

- ✅ Azure SQL Database — schema created, data loaded via bcp
- ✅ Azure OpenAI — gpt-4o-mini deployed, API key working
- ✅ Key Vault — secrets stored
- ✅ Content Safety — F0 provisioned
- ✅ Application Insights — connected to Log Analytics
- ✅ Log Analytics Workspace

---

### Day 1 Checklist

**Backend**
- ✅ uvicorn runs without errors on port 8000
- ✅ `/health` returns 200
- ✅ `/api/query/roles` returns 5 demo roles
- ✅ `/api/query/ask` calls Azure OpenAI and returns generated SQL

**Frontend**
- ✅ Vite dev server runs on port 5173
- ✅ Role switcher dropdown populated from API
- ✅ Submitting a question shows a response from the backend
- ✅ "Backend: online" indicator turns green

---

### Day 2 — Planned (Core Pipeline)

- `app/services/rbac_service.py` — Load user role from Azure SQL RBAC tables
- `app/services/sql_validator.py` — Parse LLM SQL with `sqlglot`, block unsafe patterns
- Wire full pipeline: Content Safety → SQL generation → validation → RBAC rewriting → execution → explanation
- Real query results returned as structured data (rows + column names)
- Complete the full NL-to-SQL pipeline: system prompt with Synthea schema, few-shot medical examples, sqlglot validation, safe execution with timeouts. Deploy FastAPI to App Service.
- Configure Key Vault references in App Service, enable Entra ID Easy Auth, set up managed identity. Create monitoring dashboards in Application Insights. Test end-to-end connectivity.
- Build the query experience UI: input box → loading states → SQL display panel → results table → natural language explanation panel. Implement SSE streaming from backend.
-  Integrate Content Safety into the pipeline (input + output filtering). Implement two-tier caching (in-memory L1 + Redis L2). Begin audit logging schema and write path.
- RBAC service wiring to live database
- LLM prompt engineering with Synthea schema + few-shot examples
- sqlglot SQL validation + SQL rewriter with RBAC WHERE injection
- Query execution against read-only user + result explanation

### Day 3 — Planned ( Responsible AI + innovation features) 

- Auto-visualization: bar/line/pie chart selection based on query shape
- Split `App.tsx` into components: `RoleSwitcher`, `QueryInput`, `SQLPanel`, `ResultsTable`, `VisualizationPanel`
- Replace emoji icons with Lucide React icons
- Replace inline styles with Tailwind CSS
- Implement multi-step query decomposition. Add self-correction loop (3 retries with error context). Add conversation memory for follow-up questions.
- Provision Azure Functions. Build timer-triggered function for scheduled digest generation. Configure Blob Storage for report exports. Set up Cosmos DB for audit logs if time allows.
-  Build auto-visualization engine — LLM returns chart config JSON, React dynamically renders bar/line/pie/scatter charts. Build proactive suggestion display (3 follow-up question chips after each result).
- Implement green/amber/red sensitivity classification. Build approval workflow (synchronous for demo). Add bias detection alerts for demographic queries. Build audit log viewer page.
- Content Safety integration (input + output screening)
- Sensitivity classification (green/amber/red)
- Self-correction loop (3 retries on SQL errors)
- Conversation memory for follow-up questions
---

> AI-generated analysis of synthetic data (Synthea). Results should be verified by qualified professionals.
