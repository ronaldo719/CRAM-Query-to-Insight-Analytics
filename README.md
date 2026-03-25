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

## Authentication System

The app uses a stateless JWT-based authentication system. Tokens are stored in **httpOnly cookies** — they are never exposed to JavaScript, which eliminates the XSS token-theft risk that comes with `localStorage`.

---

### How It Works — End to End

#### 1. Login

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

The backend calls `auth_service.authenticate_user()`, which:
1. Queries `dbo.app_users` joined with `dbo.app_roles` for the given username
2. Verifies the submitted password against the stored **bcrypt hash** (the plain-text password is never stored or logged)
3. On success, updates `last_login` in the database
4. Returns the user dict to the router

The router then calls `auth_service.create_access_token()` and sets the resulting JWT as a cookie with:

| Cookie attribute | Value | Why |
|---|---|---|
| `HttpOnly` | `true` | Blocks JavaScript from reading the token |
| `Secure` | `true` | Only sent over HTTPS |
| `SameSite` | `Lax` | Prevents CSRF on cross-site navigations |
| `max_age` | 28800 (8 h) | Matches token expiry |
| `path` | `/` | Sent on all API paths |

The **login response body** contains only the user object — never the raw token.

---

#### 2. Authenticated Requests

After login the browser automatically attaches `q2i_token` to every same-origin request (no JavaScript involvement). The frontend uses `credentials: "include"` on all `fetch` calls to ensure this works in cross-origin development (frontend on `:5173`, backend on `:8000`).

```
Browser                         FastAPI Backend
  │                                    │
  │── POST /api/query/ask ──────────> │
  │   Cookie: q2i_token=<jwt>         │
  │   X-Impersonate: demo_nurse       │  (optional, admin only)
  │                                    │
  │                        get_current_user() dependency:
  │                          1. Read q2i_token from Cookie
  │                          2. decode_access_token(token)
  │                          3. If X-Impersonate set and caller is admin:
  │                               load impersonated user from DB
  │                          4. Return user dict to route handler
  │                                    │
  │<─ 200 { answer, generated_sql… } ─│
```

Every protected route injects `user: dict = Depends(get_current_user)`. FastAPI calls `get_current_user()` automatically before the route handler runs.

---

#### 3. Session Validation on Page Load

On mount, `AuthProvider` calls `GET /api/auth/me` with `credentials: "include"`. If the cookie is present and the JWT is valid, the backend returns the user profile and the frontend hydrates the session. If the cookie is absent or expired, the backend returns `401` and the user is shown the login page.

```typescript
// AuthContext.tsx — runs once on app load
useEffect(() => {
  fetch(`${API_URL}/api/auth/me`, { credentials: "include" })
    .then(res => { if (!res.ok) throw new Error(); return res.json(); })
    .then(data => setUser(data))
    .catch(() => setUser(null))
    .finally(() => setIsLoading(false));
}, []);
```

---

#### 4. Logout

```
Browser                         FastAPI Backend
  │── POST /api/auth/logout ───────> │
  │   Cookie: q2i_token=<jwt>        │
  │                                    │   response.delete_cookie("q2i_token")
  │<─ 200 { message: "Logged out" } ─│
  │   Set-Cookie: q2i_token=; Max-Age=0
```

The backend deletes the cookie server-side. The frontend then clears its `user` state locally.

---

### JWT Token Structure

Tokens are signed with **HS256** using the `JWT_SECRET_KEY` environment variable (no fallback — the app refuses to start without it).

**Payload claims:**

| Claim | Example | Description |
|---|---|---|
| `sub` | `"demo_doctor"` | User's `external_id` (primary identity) |
| `user_id` | `1` | Database primary key |
| `display_name` | `"Dr. Sarah Chen"` | Human-readable name for the UI |
| `role` | `"physician"` | Role name used for RBAC decisions |
| `exp` | Unix timestamp | Expiry (8 hours from issue) |

The payload is **intentionally minimal** — only what every request needs. The full RBAC context (row scopes, column restrictions, provider ID) is loaded from the database only when a query is actually executed.

---

### Role-Based Access Control (RBAC)

The five demo roles map to different data access scopes:

| Role (`external_id`) | `role_name` | `row_scope` | Access |
|---|---|---|---|
| `demo_doctor` | `physician` | own patients | Full clinical data, own patients only |
| `demo_nurse` | `nurse` | department | Clinical data, no billing |
| `demo_billing` | `billing` | all | Financial data only, no clinical |
| `demo_researcher` | `researcher` | aggregate | Aggregate queries only, no PII |
| `demo_admin` | `admin` | all | Full access + impersonation |

The `role_name` and `row_scope` come from `dbo.app_roles`, joined at login. They are embedded in the JWT so the RBAC pipeline can start immediately on Day 2 without an extra database round-trip per request.

---

### Admin Impersonation

The admin user can act as any other user without logging out. This powers the demo role-switcher in the UI.

**How it works:**

1. Admin is logged in normally (cookie contains admin's JWT)
2. Frontend sets `X-Impersonate: demo_nurse` header via `authFetch`
3. `get_current_user()` dependency detects the header:
   - Verifies the cookie JWT is valid and belongs to an admin
   - Loads the impersonated user's full profile from the database
   - Sets `impersonated_by` on the returned user dict
4. The route handler sees the impersonated user — not the admin

Non-admin users sending `X-Impersonate` receive a `403 Forbidden`.

```python
# dependencies/auth.py
if x_impersonate and x_impersonate != payload.get("sub"):
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can impersonate.")
    impersonated = _load_user_from_db(x_impersonate)
    impersonated["impersonated_by"] = payload.get("sub")
    return impersonated
```

---

### Password Hashing

Passwords are hashed with **bcrypt** via `passlib`:

```python
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
```

- bcrypt is slow by design — each hash takes ~100ms, making brute-force impractical
- Salt is generated automatically per-hash — no two hashes for the same password are identical
- Plain-text passwords are never stored, logged, or returned by any endpoint

Demo passwords are seeded by `backend/scripts/migrate_auth.py`, which runs the bcrypt hash at migration time.

---

### Backend File Reference

| File | Purpose |
|---|---|
| `backend/app/services/auth_service.py` | Password verification, JWT creation/decoding, `authenticate_user`, `create_user` |
| `backend/app/dependencies/auth.py` | `get_current_user` (cookie → JWT → user dict), `require_admin`, `_load_user_from_db` |
| `backend/app/routers/auth.py` | `POST /login`, `POST /logout`, `GET /me`, `POST /register`, `GET /users` |
| `backend/scripts/migrate_auth.py` | One-time migration: adds `password_hash` column, seeds bcrypt hashes for demo users |

### Frontend File Reference

| File | Purpose |
|---|---|
| `frontend/src/AuthContext.tsx` | React context: session hydration, `login`, `logout`, `authFetch` wrapper, impersonation state |
| `frontend/src/LoginPage.tsx` | Login form + quick-login buttons for demo roles |

---

### Auth API Endpoints

| Method | Path | Auth required | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | No | Validate credentials, set `q2i_token` cookie |
| `POST` | `/api/auth/logout` | No | Clear `q2i_token` cookie |
| `GET` | `/api/auth/me` | Cookie | Return current user (or impersonated user) |
| `POST` | `/api/auth/register` | Cookie + admin | Create a new user account |
| `GET` | `/api/auth/users` | Cookie + admin | List all users for the impersonation dropdown |

---

### Setup — First-Time Auth Migration

After running `setup_database.py --phase seed-users` to create the user rows, run the auth migration to add password hashes:

```bash
cd backend
source venv/bin/activate
python scripts/migrate_auth.py
```

This adds the `password_hash` column to `dbo.app_users` if it doesn't exist, then bcrypt-hashes and stores the demo passwords.

**Required environment variable** — must be set before starting the backend:

```bash
JWT_SECRET_KEY=<64-char random hex>   # generate: python3 -c "import secrets; print(secrets.token_hex(32))"
```

The app will raise `RuntimeError: JWT_SECRET_KEY environment variable is not set` and refuse to start if this is missing.

---

### Security Decisions

| Decision | Rationale |
|---|---|
| httpOnly cookie (not `localStorage`) | JavaScript cannot read the token — XSS cannot steal sessions |
| `Secure` cookie flag | Token only transmitted over HTTPS |
| `SameSite=Lax` | Cookies not sent on cross-site POST requests, mitigating CSRF |
| No fallback JWT secret | Prevents accidental deployment with a weak default key |
| bcrypt for password hashing | Industry-standard slow hash; automatic salting |
| Parameterized SQL queries | All database access uses `?` placeholders — no string interpolation |
| CORS restricted to explicit methods/headers | Only `GET`, `POST`, `OPTIONS` and required headers are allowed cross-origin |

---

### Project Structure

```
CRAM-Query-to-Insight-Analytics/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI entry point, CORS config
│   │   ├── config.py            # Settings + OpenAI client factory
│   │   ├── dependencies/
│   │   │   └── auth.py          # get_current_user, require_admin (cookie-based)
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py          # /api/auth/* endpoints
│   │   │   └── query.py         # /api/query/ask and /api/query/roles
│   │   └── services/
│   │       ├── __init__.py
│   │       └── auth_service.py  # bcrypt hashing, JWT creation/decoding, DB auth
│   ├── scripts/                 # gitignored — contains credentials
│   │   └── migrate_auth.py      # Adds password_hash column, seeds demo passwords
│   ├── requirements.txt
│   └── test_openai.py
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Full Day 1 UI scaffold
│   │   ├── AuthContext.tsx      # Session state, login/logout, authFetch wrapper
│   │   ├── LoginPage.tsx        # Login form + demo role quick-login buttons
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
JWT_SECRET_KEY=...   # generate: python3 -c "import secrets; print(secrets.token_hex(32))"
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
