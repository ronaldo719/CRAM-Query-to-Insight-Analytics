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
  if (isLoading) return <div style={{ textAlign: "center", padding: 80, color: "#64748b", fontFamily: "var(--font-ui, system-ui)" }}>Loading...</div>;
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

/* -- Role badge helper ---------------------------------------- */
function RoleBadge({ role }: { role: string }) {
  const cls = ["doctor","nurse","billing","researcher","admin"].includes(role) ? role : "default";
  return <span className={`cram-role-badge ${cls}`}>{role}</span>;
}

/* -- Prism highlight helper ------------------------------------ */
function SqlBlock({ sql }: { sql: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current && (window as any).Prism) {
      (window as any).Prism.highlightElement(ref.current);
    }
  }, [sql]);
  return (
    <div className="cram-sql-block">
      <pre className="language-sql" style={{ margin: 0, borderRadius: 10, fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}>
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
      {/* ── Sticky Navbar ──────────────────────────────────────── */}
      <nav className="cram-navbar">
        <button className="cram-sidebar-toggle" onClick={() => setSidebarOpen(o => !o)}>☰</button>
        <span className="cram-navbar-brand">
          Query-to-Insight
          <span className="cram-navbar-sub">Healthcare Analytics</span>
        </span>
        <div className="cram-navbar-spacer" />
        <div className="cram-navbar-user">
          <span className="cram-navbar-name">{user?.display_name}</span>
          <RoleBadge role={activeRole ?? user?.role_name ?? ""} />
          {isAdmin && (
            <button
              onClick={() => { setShowAudit(!showAudit); if (!auditData) loadAudit(); }}
              style={nb.auditBtn}
            >
              {showAudit ? "Hide" : "Show"} audit
            </button>
          )}
          <button onClick={logout} style={nb.logoutBtn}>Sign out</button>
        </div>
      </nav>

      <div className="cram-shell">
        {/* ── Left Sidebar ─────────────────────────────────────── */}
        <aside className={`cram-sidebar${sidebarOpen ? " open" : ""}`}>
          {isAdmin && (
            <div className="cram-sidebar-section">
              <span className="cram-sidebar-label">Viewing as</span>
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
          )}

          {showAudit && auditData && (
            <div className="cram-sidebar-section">
              <span className="cram-sidebar-label">Audit dashboard</span>
              <AuditPanel data={auditData} />
            </div>
          )}

          {/* Conversation history in sidebar */}
          {history.length > 1 && (
            <div className="cram-sidebar-section">
              <span className="cram-sidebar-label">History</span>
              {history.slice(0, -1).reverse().map((entry, i) => (
                <div key={i} style={sb.histEntry}>
                  <div style={sb.histQ}>{entry.question}</div>
                  <div style={sb.histA}>{entry.result.answer.slice(0, 100)}…</div>
                </div>
              ))}
            </div>
          )}

          <div className="cram-sidebar-section">
            <span className="cram-sidebar-label">Access</span>
            <div style={sb.accessRow}>
              <span style={sb.accessKey}>Scope</span>
              <span style={sb.accessVal}>{result?.access_scope ?? "—"}</span>
            </div>
            <div style={sb.accessRow}>
              <span style={sb.accessKey}>Role</span>
              <span style={sb.accessVal}>{activeRole ?? user?.role_name ?? "—"}</span>
            </div>
          </div>
        </aside>

        {/* ── Main center column ─────────────────────────────── */}
        <main className={`cram-main${result ? " has-right" : ""}`}>
          <div className="cram-center">

            {/* ── Chat history (bubble layout) ───────────────── */}
            {history.length > 0 && (
              <div className="cram-chat-list">
                {history.slice(0, -1).map((entry, i) => (
                  <div key={i}>
                    <div className="cram-bubble-user">
                      <div className="cram-bubble-user-inner">{entry.question}</div>
                    </div>
                    <div className="cram-bubble-ai" style={{ marginTop: 8 }}>
                      <div className="cram-bubble-ai-avatar">AI</div>
                      <div className="cram-bubble-ai-inner">
                        {entry.result.answer.slice(0, 150)}{entry.result.answer.length > 150 ? "…" : ""}
                      </div>
                    </div>
                  </div>
                ))}
                {/* Current question */}
                {result && (
                  <div className="cram-bubble-user">
                    <div className="cram-bubble-user-inner">{history[history.length - 1]?.question}</div>
                  </div>
                )}
              </div>
            )}

            {/* ── Suggestion chips ──────────────────────────── */}
            {(result?.suggestions || []).length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Suggested follow-ups
                </p>
                <div className="cram-chips">
                  {result!.suggestions.map((q, i) => (
                    <button key={i} onClick={() => { setQuestion(q); handleSubmit(q); }} className="cram-chip">{q}</button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Query input ───────────────────────────────── */}
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

            {error && (
              <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", fontSize: 13, marginTop: 10 }}>
                <strong>Error:</strong> {error}
              </div>
            )}

            {/* ── Current answer (AI bubble) ────────────────── */}
            {result && (
              <div className="cram-bubble-ai" style={{ marginTop: 16 }}>
                <div className="cram-bubble-ai-avatar">AI</div>
                <div className="cram-bubble-ai-inner" style={{ maxWidth: "100%", flex: 1 }}>
                  {result.answer.split("\n").map((line, i) => (
                    <p key={i} style={{ margin: "3px 0" }}>{line}</p>
                  ))}
                </div>
              </div>
            )}

            <footer style={{ marginTop: 32, paddingTop: 12, borderTop: "1px solid #e2e8f0", fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
              <em>AI-generated analysis of synthetic data (Synthea). Results should be verified by qualified professionals.</em>
            </footer>
          </div>
        </main>

        {/* ── Right results panel ─────────────────────────────── */}
        {result && (
          <aside className="cram-right">
            {/* Sensitivity badge */}
            <div
              className="cram-sens-badge"
              style={{ background: sens.bg, borderColor: sens.border, marginBottom: 14 }}
            >
              <span className="cram-sens-icon" style={{ background: sens.dot }} />
              <span className="cram-sens-label" style={{ color: sens.text }}>
                {result.sensitivity_level} sensitivity
              </span>
              <span className="cram-sens-meta">{result.execution_time_ms}ms · {result.row_count} rows</span>
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
              <div style={{
                padding: "9px 12px", borderRadius: 8, fontSize: 12, marginBottom: 10,
                background: sens.bg, border: `1px solid ${sens.border}`, color: sens.text,
              }}>
                {result.sensitivity_advisory}
              </div>
            )}

            {/* SQL transparency toggle */}
            <div style={{ marginBottom: 6 }}>
              <button onClick={() => setShowSql(!showSql)} className="cram-toggle-btn">
                {showSql ? "▲" : "▼"} {showSql ? "Hide" : "Show"} SQL
                <span className="cram-transparency-tag">Transparency</span>
              </button>
            </div>
            {showSql && (
              <div style={{ marginBottom: 10 }}>
                <SqlBlock sql={result.generated_sql} />
                {result.was_modified && (
                  <div style={{ marginTop: 6, padding: "6px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, fontSize: 11, color: "#92400e" }}>
                    Modified for access control: {result.modification_explanation}
                  </div>
                )}
              </div>
            )}

            {/* Data table toggle */}
            {result.result_columns.length > 0 && result.result_rows.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <button onClick={() => setShowTable(!showTable)} className="cram-toggle-btn">
                  {showTable ? "▲" : "▼"} {showTable ? "Hide" : "Show"} table ({result.row_count} rows)
                </button>
                {showTable && (
                  <div style={{ marginTop: 6 }}>
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
                      <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, textAlign: "center" }}>
                        Showing 50 of {result.result_rows.length} rows
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Warnings */}
            {result.warnings.length > 0 && !result.bias_alert && (
              <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>
                {result.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "2px 0", color: "#991b1b" }}>{w}</div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/* -- Audit Panel (admin only) --------------------------------- */
function AuditPanel({ data }: { data: any }) {
  return (
    <div>
      <div className="cram-audit-grid">
        <div className="cram-audit-stat">
          <div className="cram-audit-stat-value">{data.total_queries}</div>
          <div className="cram-audit-stat-label">Total queries</div>
        </div>
        <div className="cram-audit-stat">
          <div className="cram-audit-stat-value" style={{ color: "#ef4444" }}>{data.denied_count}</div>
          <div className="cram-audit-stat-label">Denied ({data.denial_rate}%)</div>
        </div>
        <div className="cram-audit-stat">
          <div className="cram-audit-stat-value" style={{ color: "#f59e0b" }}>{data.modified_count}</div>
          <div className="cram-audit-stat-label">RBAC modified</div>
        </div>
        <div className="cram-audit-stat">
          <div className="cram-audit-stat-value">{data.avg_latency_ms}ms</div>
          <div className="cram-audit-stat-label">Avg latency</div>
        </div>
      </div>
      {data.by_role?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {data.by_role.map((r: any, i: number) => (
            <div key={i} style={{ fontSize: 11, color: "#475569", padding: "2px 0", display: "flex", justifyContent: "space-between" }}>
              <span>{r.role}</span>
              <span style={{ color: "#94a3b8" }}>{r.queries}q / {r.denied} denied</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -- Navbar button styles ------------------------------------- */
const nb: Record<string, React.CSSProperties> = {
  logoutBtn: { padding: "5px 12px", fontSize: 12, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", color: "#475569", fontFamily: "var(--font-ui, system-ui)" },
  auditBtn:  { padding: "5px 12px", fontSize: 12, background: "#e0f0fa", border: "1px solid #a8d4f0", borderRadius: 6, cursor: "pointer", color: "#1D6FA8", fontFamily: "var(--font-ui, system-ui)" },
};

/* -- Sidebar item styles -------------------------------------- */
const sb: Record<string, React.CSSProperties> = {
  histEntry: { padding: "8px 0", borderBottom: "1px solid #f1f5f9" },
  histQ:     { fontSize: 12, fontWeight: 600, color: "#1e293b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  histA:     { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  accessRow: { display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" },
  accessKey: { color: "#94a3b8", fontWeight: 500 },
  accessVal: { color: "#334155", fontWeight: 600, textAlign: "right" as const, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
};
