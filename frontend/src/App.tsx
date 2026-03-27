import { useState, useEffect, useRef } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import LoginPage from "./LoginPage";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();
  if (isLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "Inter, system-ui, sans-serif", color: "#6b7280", fontSize: 14 }}>
      Loading…
    </div>
  );
  if (!user) return <LoginPage />;
  return <QueryInterface />;
}

/* -- Types ---------------------------------------------------- */
interface QueryResult {
  answer: string;
  visualization: any | null;
  generated_sql: string;
  executed_sql: string;
  was_modified: boolean;
  modification_explanation: string;
  tables_accessed: string[];
  role_name: string;
  access_scope: string;
  warnings: string[];
  row_count: number;
  execution_time_ms: number;
  confidence: string;
  sensitivity_level: string;
  sensitivity_advisory: string;
  bias_alert: string | null;
  suggestions: string[];
  result_columns: string[];
  result_rows: (string | null)[][];
}

/* -- Role badge ----------------------------------------------- */
function RoleBadge({ role }: { role: string }) {
  const cls = ["doctor","nurse","billing","researcher","admin"].includes(role) ? role : "default";
  return <span className={`cram-role-badge ${cls}`}>{role}</span>;
}

/* -- Initials from display name ------------------------------ */
function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

/* -- Prism SQL block ----------------------------------------- */
function SqlBlock({ sql }: { sql: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current && (window as any).Prism) {
      (window as any).Prism.highlightElement(ref.current);
    }
  }, [sql]);
  return (
    <div className="cram-sql-block">
      <pre className="language-sql" style={{ margin: 0 }}>
        <code ref={ref} className="language-sql">{sql}</code>
      </pre>
    </div>
  );
}

/* -- Main Interface ------------------------------------------- */
function QueryInterface() {
  const { user, isAdmin, impersonating, impersonatableUsers, setImpersonating, authFetch, logout } = useAuth();

  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState<{ question: string; result: QueryResult }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [auditData, setAuditData] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeRole = impersonating
    ? impersonatableUsers.find(u => u.external_id === impersonating)?.role_name
    : user?.role_name;

  /* -- Clear conversation on role switch ---------------------- */
  const handleRoleSwitch = async (externalId: string | null) => {
    setImpersonating(externalId);
    setResult(null);
    setHistory([]);
    try {
      await authFetch(`${API_URL}/api/query/clear-history`, { method: "POST" });
    } catch { /* non-critical */ }
  };

  /* -- Submit query ------------------------------------------- */
  const handleSubmit = async (q?: string) => {
    const queryText = q || question;
    if (!queryText.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await authFetch(`${API_URL}/api/query/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: queryText }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: QueryResult = await res.json();
      setResult(data);
      setHistory(prev => [...prev, { question: queryText, result: data }]);
      setQuestion("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /* -- Load audit stats --------------------------------------- */
  const loadAudit = async () => {
    try {
      const res = await authFetch(`${API_URL}/api/audit/stats`);
      if (res.ok) setAuditData(await res.json());
    } catch { /* non-critical */ }
  };

  const SENS = {
    green: { bg: "var(--sens-green-bg)", border: "var(--sens-green-border)", text: "var(--sens-green-text)", dot: "var(--sens-green-dot)" },
    amber: { bg: "var(--sens-amber-bg)", border: "var(--sens-amber-border)", text: "var(--sens-amber-text)", dot: "var(--sens-amber-dot)" },
    red:   { bg: "var(--sens-red-bg)",   border: "var(--sens-red-border)",   text: "var(--sens-red-text)",   dot: "var(--sens-red-dot)" },
  } as Record<string, { bg: string; border: string; text: string; dot: string }>;

  const sens = SENS[result?.sensitivity_level ?? ""] ?? SENS.green;

  return (
    <div className="cram-root">

      {/* ── Navbar ─────────────────────────────────────────────── */}
      <nav className="cram-navbar">
        {/* Logo zone — lines up with sidebar */}
        <div className="cram-navbar-logo">
          <button className="cram-sidebar-toggle" onClick={() => setSidebarOpen(o => !o)}>☰</button>
          <div className="cram-navbar-mark">Q</div>
          <span className="cram-navbar-brand">Query-to-Insight</span>
        </div>

        {/* Content zone */}
        <div className="cram-navbar-content">
          <span className="cram-navbar-title">Healthcare Analytics</span>
          <div className="cram-navbar-spacer" />
          <div className="cram-navbar-actions">
            {isAdmin && (
              <button
                className="cram-nav-btn"
                onClick={() => { setShowAudit(!showAudit); if (!auditData) loadAudit(); }}
              >
                {showAudit ? "Hide" : "Show"} audit
              </button>
            )}
            <RoleBadge role={activeRole ?? user?.role_name ?? ""} />
            <span className="cram-navbar-name">{user?.display_name}</span>
            <div className="cram-navbar-avatar" title={user?.display_name}>
              {initials(user?.display_name ?? "U")}
            </div>
            <button className="cram-nav-btn-ghost" onClick={logout}>Sign out</button>
          </div>
        </div>
      </nav>

      <div className="cram-shell">

        {/* ── Dark sidebar ───────────────────────────────────────── */}
        <aside className={`cram-sidebar${sidebarOpen ? " open" : ""}`}>
          <nav className="cram-sidebar-nav">

            {/* Static nav items */}
            <span className="cram-sidebar-section-label">Workspace</span>
            <button className="cram-sidebar-item active">
              <span className="cram-sidebar-icon">💬</span>
              Analytics Query
            </button>

            {isAdmin && (
              <>
                <div className="cram-sidebar-divider" />
                <span className="cram-sidebar-section-label">Admin</span>

                {/* Impersonation */}
                <div className="cram-sidebar-inner">
                  <div style={{ fontSize: 11, color: "var(--sidebar-text)", marginBottom: 4, fontWeight: 500 }}>Viewing as</div>
                  {impersonatableUsers.length > 0 && (
                    <select
                      value={impersonating || ""}
                      onChange={e => handleRoleSwitch(e.target.value || null)}
                      className="cram-imp-select"
                    >
                      <option value="">Myself (Admin)</option>
                      {impersonatableUsers.filter(u => u.external_id !== user?.external_id).map(u => (
                        <option key={u.external_id} value={u.external_id}>{u.display_name} — {u.role_name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </>
            )}

            {/* Audit panel */}
            {showAudit && auditData && (
              <>
                <div className="cram-sidebar-divider" />
                <span className="cram-sidebar-section-label">Audit</span>
                <div className="cram-sidebar-inner">
                  <AuditPanel data={auditData} />
                </div>
              </>
            )}

            {/* History */}
            {history.length > 1 && (
              <>
                <div className="cram-sidebar-divider" />
                <span className="cram-sidebar-section-label">History</span>
                <div className="cram-sidebar-inner">
                  {history.slice(0, -1).reverse().map((entry, i) => (
                    <div key={i} className="cram-sidebar-hist">
                      <div className="cram-sidebar-hist-q">{entry.question}</div>
                      <div className="cram-sidebar-hist-a">{entry.result.answer.slice(0, 80)}…</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Access info */}
            {result && (
              <>
                <div className="cram-sidebar-divider" />
                <span className="cram-sidebar-section-label">Access</span>
                <div className="cram-sidebar-inner">
                  <div className="cram-sidebar-kv">
                    <span className="cram-sidebar-kv-key">Role</span>
                    <span className="cram-sidebar-kv-val">{activeRole ?? user?.role_name}</span>
                  </div>
                  <div className="cram-sidebar-kv">
                    <span className="cram-sidebar-kv-key">Scope</span>
                    <span className="cram-sidebar-kv-val">{result.access_scope}</span>
                  </div>
                  <div className="cram-sidebar-kv">
                    <span className="cram-sidebar-kv-key">Latency</span>
                    <span className="cram-sidebar-kv-val">{result.execution_time_ms}ms</span>
                  </div>
                </div>
              </>
            )}
          </nav>

          {/* Sidebar user footer */}
          <div className="cram-sidebar-footer">
            <div className="cram-sidebar-footer-avatar">{initials(user?.display_name ?? "U")}</div>
            <div>
              <div className="cram-sidebar-footer-name">{user?.display_name}</div>
              <div className="cram-sidebar-footer-role">{user?.role_name}</div>
            </div>
          </div>
        </aside>

        {/* ── Center column ──────────────────────────────────────── */}
        <main className={`cram-main${result ? " has-right" : ""}`}>
          <div className="cram-center">

            {/* Page header */}
            {!result && history.length === 0 && (
              <div className="cram-page-header">
                <h1 className="cram-page-header-title">Analytics Query</h1>
                <p className="cram-page-header-sub">Ask natural language questions about your healthcare data.</p>
              </div>
            )}

            {/* Chat history bubbles */}
            {history.length > 0 && (
              <div className="cram-chat-list">
                {history.slice(0, -1).map((entry, i) => (
                  <div key={i}>
                    <div className="cram-bubble-user">
                      <div className="cram-bubble-user-inner">{entry.question}</div>
                    </div>
                    <div className="cram-bubble-ai" style={{ marginTop: 10 }}>
                      <div className="cram-bubble-ai-avatar">AI</div>
                      <div className="cram-bubble-ai-inner">
                        {entry.result.answer.slice(0, 160)}{entry.result.answer.length > 160 ? "…" : ""}
                      </div>
                    </div>
                  </div>
                ))}
                {result && (
                  <div className="cram-bubble-user">
                    <div className="cram-bubble-user-inner">{history[history.length - 1]?.question}</div>
                  </div>
                )}
              </div>
            )}

            {/* Current AI answer */}
            {result && (
              <div className="cram-bubble-ai" style={{ marginBottom: 20 }}>
                <div className="cram-bubble-ai-avatar">AI</div>
                <div className="cram-bubble-ai-inner" style={{ maxWidth: "100%", flex: 1 }}>
                  {result.answer.split("\n").map((line, i) => (
                    <p key={i} style={{ margin: "3px 0" }}>{line}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestion chips */}
            {(result?.suggestions || []).length > 0 && (
              <div className="cram-chips-wrap">
                <div className="cram-chips-label">Suggested follow-ups</div>
                <div className="cram-chips">
                  {result!.suggestions.map((q, i) => (
                    <button key={i} onClick={() => { setQuestion(q); handleSubmit(q); }} className="cram-chip">{q}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Query input */}
            <div className="cram-input-card">
              <div className="cram-input-bar">
                <textarea
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder="Ask a question about your healthcare data…"
                  className="cram-textarea"
                  rows={2}
                />
                <button
                  onClick={() => handleSubmit()}
                  disabled={loading || !question.trim()}
                  className="cram-submit-btn"
                >
                  {loading ? "Analyzing…" : "Ask"}
                </button>
              </div>
              <div className="cram-input-hint">Press Enter to send · Shift+Enter for new line</div>
            </div>

            {error && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", fontSize: 13 }}>
                <strong>Error:</strong> {error}
              </div>
            )}

            <footer style={{ marginTop: 36, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
              AI-generated analysis of synthetic data (Synthea). Results should be verified by qualified professionals.
            </footer>
          </div>
        </main>

        {/* ── Right insight panel ─────────────────────────────────── */}
        {result && (
          <aside className="cram-right">

            {/* Sensitivity */}
            <div
              className="cram-sens-badge"
              style={{ background: sens.bg, borderColor: sens.border, marginBottom: 10 }}
            >
              <span className="cram-sens-icon" style={{ background: sens.dot }} />
              <span className="cram-sens-label" style={{ color: sens.text }}>
                {result.sensitivity_level} sensitivity
              </span>
              <span className="cram-sens-meta">{result.row_count} rows</span>
            </div>

            {/* Bias alert */}
            {result.bias_alert && (
              <div className="cram-bias-banner" style={{ marginBottom: 10 }}>
                <span className="cram-bias-icon">⚠</span>
                <div><strong>Fairness notice:</strong> {result.bias_alert}</div>
              </div>
            )}

            {/* Sensitivity advisory */}
            {result.sensitivity_advisory && result.sensitivity_level !== "green" && (
              <div className="cram-right-card" style={{ marginBottom: 10 }}>
                <div className="cram-right-card-body" style={{ fontSize: 12, color: sens.text, background: sens.bg }}>
                  {result.sensitivity_advisory}
                </div>
              </div>
            )}

            {/* SQL transparency */}
            <div className="cram-right-card" style={{ marginBottom: 10 }}>
              <div className="cram-right-card-header">
                <span className="cram-right-card-title">Generated SQL</span>
                <button onClick={() => setShowSql(!showSql)} className="cram-toggle-btn">
                  {showSql ? "Hide" : "Show"}
                  <span className="cram-transparency-tag">Transparency</span>
                </button>
              </div>
              {showSql && (
                <div className="cram-right-card-body" style={{ padding: "10px" }}>
                  <SqlBlock sql={result.generated_sql} />
                  {result.was_modified && (
                    <div style={{ marginTop: 8, padding: "6px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, fontSize: 11, color: "#92400e" }}>
                      Modified for access control: {result.modification_explanation}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Data table */}
            {result.result_columns.length > 0 && result.result_rows.length > 0 && (
              <div className="cram-right-card" style={{ marginBottom: 10 }}>
                <div className="cram-right-card-header">
                  <span className="cram-right-card-title">Data ({result.row_count} rows)</span>
                  <button onClick={() => setShowTable(!showTable)} className="cram-toggle-btn">
                    {showTable ? "Hide" : "Show"}
                  </button>
                </div>
                {showTable && (
                  <div style={{ padding: "10px" }}>
                    <div className="cram-table-wrap">
                      <table className="cram-table">
                        <thead>
                          <tr>{result.result_columns.map((col, i) => <th key={i}>{col}</th>)}</tr>
                        </thead>
                        <tbody>
                          {result.result_rows.slice(0, 50).map((row, i) => (
                            <tr key={i}>
                              {row.map((val, j) => <td key={j}>{val ?? "—"}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {result.result_rows.length > 50 && (
                      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, textAlign: "center" }}>
                        Showing 50 of {result.result_rows.length} rows
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Warnings */}
            {result.warnings.length > 0 && !result.bias_alert && (
              <div className="cram-right-card">
                <div className="cram-right-card-body">
                  {result.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 11, padding: "2px 0", color: "#991b1b" }}>{w}</div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/* -- Audit Panel --------------------------------------------- */
function AuditPanel({ data }: { data: any }) {
  return (
    <div>
      <div className="cram-audit-grid">
        <div className="cram-audit-stat">
          <div className="cram-audit-stat-value">{data.total_queries}</div>
          <div className="cram-audit-stat-label">Total</div>
        </div>
        <div className="cram-audit-stat">
          <div className="cram-audit-stat-value" style={{ color: "#ef4444" }}>{data.denied_count}</div>
          <div className="cram-audit-stat-label">Denied</div>
        </div>
        <div className="cram-audit-stat">
          <div className="cram-audit-stat-value" style={{ color: "#f59e0b" }}>{data.modified_count}</div>
          <div className="cram-audit-stat-label">Modified</div>
        </div>
        <div className="cram-audit-stat">
          <div className="cram-audit-stat-value">{data.avg_latency_ms}ms</div>
          <div className="cram-audit-stat-label">Avg latency</div>
        </div>
      </div>
      {data.by_role?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {data.by_role.map((r: any, i: number) => (
            <div key={i} style={{ fontSize: 10, color: "var(--sidebar-text)", padding: "3px 0", display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--sidebar-border)" }}>
              <span style={{ color: "var(--sidebar-text-h)" }}>{r.role}</span>
              <span>{r.queries}q · {r.denied} denied</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
