import { useState, useEffect } from "react";
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
  if (isLoading) return <div style={{ textAlign: "center", padding: 80, color: "#64748b" }}>Loading...</div>;
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

  const SENSITIVITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
    green: { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
    amber: { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
    red: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
  };

  return (
    <div style={s.container}>
      {/* -- Header -------------------------------------------- */}
      <header style={s.header}>
        <div>
          <h1 style={s.title}>Query-to-Insight</h1>
          <p style={s.subtitle}>Healthcare Analytics Engine</p>
        </div>
        <div style={s.headerRight}>
          {isAdmin && (
            <button onClick={() => { setShowAudit(!showAudit); if (!auditData) loadAudit(); }}
              style={s.auditBtn}>
              {showAudit ? "Hide" : "Show"} audit log
            </button>
          )}
          <div style={s.userInfo}>
            <div style={s.userName}>{user?.display_name}</div>
            <div style={s.userRole}>{user?.role_name}</div>
          </div>
          <button onClick={logout} style={s.logoutBtn}>Sign out</button>
        </div>
      </header>

      {/* -- Admin impersonation ------------------------------- */}
      {isAdmin && impersonatableUsers.length > 0 && (
        <div style={s.impPanel}>
          <label style={s.impLabel}>Viewing as:</label>
          <select value={impersonating || ""} onChange={e => handleRoleSwitch(e.target.value || null)} style={s.impSelect}>
            <option value="">Myself (Admin - full access)</option>
            {impersonatableUsers.filter(u => u.external_id !== user?.external_id).map(u => (
              <option key={u.external_id} value={u.external_id}>{u.display_name} - {u.role_name}</option>
            ))}
          </select>
        </div>
      )}

      {/* -- Audit panel --------------------------------------- */}
      {showAudit && auditData && <AuditPanel data={auditData} />}

      {/* -- Suggestion chips ---------------------------------- */}
      {(result?.suggestions || []).length > 0 && (
        <div style={s.suggestionsSection}>
          <p style={s.suggestionsLabel}>Suggested follow-ups:</p>
          <div style={s.suggestionsRow}>
            {result!.suggestions.map((q, i) => (
              <button key={i} onClick={() => { setQuestion(q); handleSubmit(q); }} style={s.suggestionChip}>{q}</button>
            ))}
          </div>
        </div>
      )}

      {/* -- Query input --------------------------------------- */}
      <div style={s.inputSection}>
        <textarea value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder="Ask a question about your healthcare data..." style={s.textarea} rows={2} />
        <button onClick={() => handleSubmit()} disabled={loading || !question.trim()}
          style={{ ...s.submitBtn, opacity: loading || !question.trim() ? 0.5 : 1 }}>
          {loading ? "Analyzing..." : "Ask"}
        </button>
      </div>

      {error && <div style={s.errorBox}><strong>Error:</strong> {error}</div>}

      {/* -- Results ------------------------------------------- */}
      {result && (
        <div style={s.resultsSection}>
          {/* Sensitivity badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 14px", borderRadius: 8,
            background: SENSITIVITY_COLORS[result.sensitivity_level]?.bg || "#f8fafc",
            border: `1px solid ${SENSITIVITY_COLORS[result.sensitivity_level]?.border || "#e2e8f0"}`,
          }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%",
              background: result.sensitivity_level === "green" ? "#22c55e" : result.sensitivity_level === "amber" ? "#f59e0b" : "#ef4444",
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: SENSITIVITY_COLORS[result.sensitivity_level]?.text }}>
              {result.sensitivity_level.toUpperCase()} sensitivity
            </span>
            <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>
              Role: {result.role_name} | Scope: {result.access_scope} | {result.execution_time_ms}ms
              {result.row_count > 0 && ` | ${result.row_count} rows`}
            </span>
          </div>

          {/* Answer */}
          <div style={s.answerPanel}>
            <h3 style={s.panelTitle}>Answer</h3>
            <div style={s.answerText}>
              {result.answer.split("\n").map((line, i) => <p key={i} style={{ margin: "4px 0" }}>{line}</p>)}
            </div>
          </div>

          {/* Bias alert */}
          {result.bias_alert && (
            <div style={s.biasAlert}>
              <strong>Fairness notice:</strong> {result.bias_alert}
            </div>
          )}

          {/* Sensitivity advisory */}
          {result.sensitivity_advisory && result.sensitivity_level !== "green" && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, fontSize: 13,
              background: SENSITIVITY_COLORS[result.sensitivity_level]?.bg,
              border: `1px solid ${SENSITIVITY_COLORS[result.sensitivity_level]?.border}`,
              color: SENSITIVITY_COLORS[result.sensitivity_level]?.text,
            }}>
              {result.sensitivity_advisory}
            </div>
          )}

          {/* SQL transparency toggle */}
          <button onClick={() => setShowSql(!showSql)} style={s.toggleBtn}>
            {showSql ? "Hide" : "Show"} generated SQL
            <span style={s.transparencyBadge}>Transparency</span>
          </button>
          {showSql && (
            <div style={s.sqlPanel}>
              <pre style={s.sqlCode}>{result.generated_sql}</pre>
              {result.was_modified && (
                <div style={s.modifiedNotice}>
                  Query modified for access control: {result.modification_explanation}
                </div>
              )}
            </div>
          )}

          {/* Results table toggle */}
          {result.result_columns.length > 0 && result.result_rows.length > 0 && (
            <>
              <button onClick={() => setShowTable(!showTable)} style={s.toggleBtn}>
                {showTable ? "Hide" : "Show"} data table ({result.row_count} rows)
              </button>
              {showTable && (
                <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #cbd5e1" }}>
                  <table style={s.table}>
                    <thead>
                      <tr>{result.result_columns.map((col, i) => <th key={i} style={s.th}>{col}</th>)}</tr>
                    </thead>
                    <tbody>
                      {result.result_rows.slice(0, 50).map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                          {row.map((val, j) => <td key={j} style={s.td}>{val ?? "-"}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.result_rows.length > 50 && (
                    <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                      Showing 50 of {result.result_rows.length} rows
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Warnings */}
          {result.warnings.length > 0 && !result.bias_alert && (
            <div style={s.warningsPanel}>
              {result.warnings.map((w, i) => <div key={i} style={s.warningItem}>{w}</div>)}
            </div>
          )}
        </div>
      )}

      {/* -- Conversation history ------------------------------- */}
      {history.length > 1 && (
        <div style={s.historySection}>
          <h3 style={s.panelTitle}>Conversation history</h3>
          {history.slice(0, -1).reverse().map((entry, i) => (
            <div key={i} style={s.historyEntry}>
              <div style={s.historyQ}>{entry.question}</div>
              <div style={s.historyA}>{entry.result.answer.slice(0, 150)}...</div>
            </div>
          ))}
        </div>
      )}

      <footer style={s.footer}>
        <em>AI-generated analysis of synthetic data (Synthea). Results should be verified by qualified professionals.</em>
      </footer>
    </div>
  );
}

/* -- Audit Panel (admin only) --------------------------------- */
function AuditPanel({ data }: { data: any }) {
  return (
    <div style={s.auditPanel}>
      <h3 style={s.panelTitle}>Audit dashboard</h3>
      <div style={s.auditGrid}>
        <div style={s.auditStat}>
          <div style={s.auditStatValue}>{data.total_queries}</div>
          <div style={s.auditStatLabel}>Total queries</div>
        </div>
        <div style={s.auditStat}>
          <div style={{ ...s.auditStatValue, color: "#ef4444" }}>{data.denied_count}</div>
          <div style={s.auditStatLabel}>Denied ({data.denial_rate}%)</div>
        </div>
        <div style={s.auditStat}>
          <div style={{ ...s.auditStatValue, color: "#f59e0b" }}>{data.modified_count}</div>
          <div style={s.auditStatLabel}>Modified by RBAC</div>
        </div>
        <div style={s.auditStat}>
          <div style={s.auditStatValue}>{data.avg_latency_ms}ms</div>
          <div style={s.auditStatLabel}>Avg latency</div>
        </div>
      </div>
      {data.by_role?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 13 }}>By role:</strong>
          {data.by_role.map((r: any, i: number) => (
            <div key={i} style={{ fontSize: 13, color: "#475569", padding: "2px 0" }}>
              {r.role}: {r.queries} queries, {r.denied} denied
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -- Styles --------------------------------------------------- */
const s: Record<string, React.CSSProperties> = {
  container: { maxWidth: 900, margin: "0 auto", padding: "20px 20px", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: "#1a1a2e" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 12, color: "#64748b", marginTop: 2 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  userInfo: { textAlign: "right" as const },
  userName: { fontSize: 13, fontWeight: 600 },
  userRole: { fontSize: 11, color: "#64748b" },
  logoutBtn: { padding: "5px 12px", fontSize: 12, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", color: "#475569" },
  auditBtn: { padding: "5px 12px", fontSize: 12, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, cursor: "pointer", color: "#1e40af" },

  impPanel: { marginBottom: 12, padding: 12, background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a" },
  impLabel: { fontSize: 12, fontWeight: 600, color: "#92400e" },
  impSelect: { width: "100%", padding: "6px 8px", fontSize: 13, borderRadius: 6, border: "1px solid #fde68a", background: "#fff", cursor: "pointer", marginTop: 4 },

  suggestionsSection: { marginBottom: 12 },
  suggestionsLabel: { fontSize: 12, color: "#64748b", marginBottom: 6 },
  suggestionsRow: { display: "flex", gap: 6, flexWrap: "wrap" as const },
  suggestionChip: { padding: "6px 12px", fontSize: 13, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 20, cursor: "pointer", color: "#1e40af" },

  inputSection: { display: "flex", gap: 8, marginBottom: 16, alignItems: "flex-end" },
  textarea: { flex: 1, padding: "10px 12px", fontSize: 14, borderRadius: 8, border: "1px solid #cbd5e1", resize: "none" as const, fontFamily: "inherit", outline: "none" },
  submitBtn: { padding: "10px 20px", fontSize: 14, fontWeight: 600, background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" as const },

  errorBox: { padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", fontSize: 13, marginBottom: 12 },

  resultsSection: { display: "flex", flexDirection: "column" as const, gap: 10 },
  answerPanel: { padding: 16, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 },
  panelTitle: { fontSize: 13, fontWeight: 600, color: "#475569", marginTop: 0, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 },
  answerText: { fontSize: 14, lineHeight: 1.6 },

  biasAlert: { padding: "10px 14px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, fontSize: 13, color: "#92400e", lineHeight: 1.5 },

  toggleBtn: { padding: "6px 12px", fontSize: 12, background: "none", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", color: "#475569", display: "flex", alignItems: "center", gap: 6, width: "fit-content" },
  transparencyBadge: { fontSize: 10, padding: "1px 6px", background: "#dbeafe", color: "#1e40af", borderRadius: 20 },
  sqlPanel: { padding: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 },
  sqlCode: { background: "#1e293b", color: "#e2e8f0", padding: 14, borderRadius: 6, fontSize: 12, overflow: "auto" as const, whiteSpace: "pre-wrap" as const, fontFamily: '"Fira Code", Consolas, monospace' },
  modifiedNotice: { marginTop: 8, padding: "6px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, fontSize: 12, color: "#92400e" },

  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 8 },
  th: { padding: "10px 14px", background: "#1e293b", borderBottom: "2px solid #334155", textAlign: "left" as const, fontWeight: 600, color: "#f1f5f9", whiteSpace: "nowrap" as const, letterSpacing: "0.025em" },
  td: { padding: "9px 14px", borderBottom: "1px solid #e2e8f0", color: "#1e293b", fontWeight: 500, maxWidth: 240, overflow: "hidden" as const, textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const },

  warningsPanel: { padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 },
  warningItem: { fontSize: 13, padding: "3px 0", color: "#991b1b" },

  historySection: { marginTop: 20, padding: 14, background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" },
  historyEntry: { padding: "8px 0", borderBottom: "1px solid #e2e8f0" },
  historyQ: { fontSize: 13, fontWeight: 600, color: "#1e293b" },
  historyA: { fontSize: 12, color: "#64748b", marginTop: 2 },

  auditPanel: { marginBottom: 16, padding: 16, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 },
  auditGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 8 },
  auditStat: { textAlign: "center" as const },
  auditStatValue: { fontSize: 22, fontWeight: 700, color: "#1e293b" },
  auditStatLabel: { fontSize: 11, color: "#64748b" },

  footer: { marginTop: 24, paddingTop: 12, borderTop: "1px solid #e2e8f0", fontSize: 11, color: "#94a3b8", textAlign: "center" as const },
};
