import { useState } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import LoginPage from "./LoginPage";
import ChartRenderer from "./components/ChartRenderer";
import ResultsTable from "./components/ResultsTable";
import RAIBanner from "./components/RAIBanner";
import AuditDashboard from "./components/AuditDashboard";

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
  if (isLoading) return <div style={s.loadingPage}>Loading...</div>;
  if (!user) return <LoginPage />;
  return <QueryInterface />;
}

/* —— Types ———————————————————————————————————————————————————— */
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

/* —— Main Query Interface ———————————————————————————————————— */
function QueryInterface() {
  const {
    user, isAdmin, impersonating, impersonatableUsers,
    setImpersonating, authFetch, logout,
  } = useAuth();

  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const activeUser = impersonating
    ? impersonatableUsers.find(u => u.external_id === impersonating)
    : null;
  const activeRole = activeUser?.role_name || user?.role_name || "";
  const activeDisplayName = activeUser?.display_name || user?.display_name || "";

  /* —— Role switch ——————————————————————————————————————————— */
  const handleRoleSwitch = async (externalId: string | null) => {
    setImpersonating(externalId);
    setResult(null);
    setError(null);
    try {
      await authFetch(`${API_URL}/api/query/clear-history`, { method: "POST" });
    } catch { /* non-critical */ }
  };

  /* —— Submit ————————————————————————————————————————————————— */
  const handleSubmit = async (q?: string) => {
    const text = q || question;
    if (!text.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await authFetch(`${API_URL}/api/query/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setResult(await res.json());
      setQuestion("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.container}>
        {/* —— Header ——————————————————————————————————————————— */}
        <header style={s.header}>
          <div>
            <h1 style={s.title}>Query-to-Insight</h1>
            <p style={s.subtitle}>Healthcare Analytics Engine</p>
          </div>
          <div style={s.headerRight}>
            {isAdmin && (
              <button
                onClick={() => setShowAudit(!showAudit)}
                style={s.headerBtn}
              >
                {showAudit ? "Hide" : ""} Audit
              </button>
            )}
            <div style={s.userPill}>
              <div style={s.userName}>{user?.display_name}</div>
              <div style={s.userRole}>{user?.role_name}</div>
            </div>
            <button onClick={logout} style={s.logoutBtn}>Sign out</button>
          </div>
        </header>

        {/* —— Admin impersonation ————————————————————————————— */}
        {isAdmin && impersonatableUsers.length > 0 && (
          <div style={s.impBar}>
            <span style={s.impLabel}>Viewing as:</span>
            <select
              value={impersonating || ""}
              onChange={e => handleRoleSwitch(e.target.value || null)}
              style={s.impSelect}
            >
              <option value="">Myself — Admin (full access)</option>
              {impersonatableUsers
                .filter(u => u.external_id !== user?.external_id)
                .map(u => (
                  <option key={u.external_id} value={u.external_id}>
                    {u.display_name} — {u.role_name} ({u.row_scope})
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* —— Non-admin role badge ———————————————————————————— */}
        {!isAdmin && (
          <div style={s.roleBadge}>
            <strong>{user?.display_name}</strong>
            <span style={{ color: "#64748b", marginLeft: 8 }}>
              {user?.role_name} — {(user as any)?.row_scope || "standard"}
            </span>
          </div>
        )}

        {/* —— Audit dashboard ————————————————————————————————— */}
        {showAudit && <AuditDashboard />}

        {/* —— Suggestion chips ———————————————————————————————— */}
        {(result?.suggestions || []).length > 0 && (
          <div style={s.suggestions}>
            <span style={s.sugLabel}>Follow up:</span>
            {result!.suggestions.map((q, i) => (
              <button
                key={i}
                onClick={() => { setQuestion(q); handleSubmit(q); }}
                style={s.sugChip}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* —— Query input ————————————————————————————————————— */}
        <div style={s.inputRow}>
          <div style={s.inputWrapper}>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={`Ask a question as ${activeDisplayName}...`}
              style={s.textarea}
              rows={2}
            />
            <button
              onClick={() => handleSubmit()}
              disabled={loading || !question.trim()}
              style={{
                ...s.submitBtn,
                opacity: loading || !question.trim() ? 0.5 : 1,
              }}
            >
              {loading ? (
                <span style={s.spinner} />
              ) : (
                "Ask"
              )}
            </button>
          </div>
        </div>

        {/* —— Error ——————————————————————————————————————————— */}
        {error && (
          <div style={s.errorBox}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* —— Results ————————————————————————————————————————— */}
        {result && (
          <div style={s.results}>
            {/* RAI Banner */}
            <RAIBanner
              sensitivityLevel={result.sensitivity_level}
              confidence={result.confidence}
              roleName={result.role_name}
              accessScope={result.access_scope}
              executionTimeMs={result.execution_time_ms}
              rowCount={result.row_count}
              wasModified={result.was_modified}
              impersonating={!!impersonating}
            />

            {/* Answer */}
            <div style={s.answerCard}>
              <div style={s.answerText}>
                {result.answer.split("\n").map((line, i) => (
                  <p key={i} style={{ margin: "3px 0" }}>{line}</p>
                ))}
              </div>
            </div>

            {/* Bias alert */}
            {result.bias_alert && (
              <div style={s.biasAlert}>
                <strong>Fairness notice:</strong> {result.bias_alert}
              </div>
            )}

            {/* Sensitivity advisory */}
            {result.sensitivity_advisory &&
              result.sensitivity_level !== "green" &&
              result.confidence !== "denied" && (
              <div style={{
                ...s.advisory,
                background: result.sensitivity_level === "amber" ? "#fffbeb" : "#fef2f2",
                borderColor: result.sensitivity_level === "amber" ? "#fde68a" : "#fecaca",
                color: result.sensitivity_level === "amber" ? "#92400e" : "#991b1b",
              }}>
                {result.sensitivity_advisory}
              </div>
            )}

            {/* Visualization */}
            {result.visualization && result.visualization.chartType !== "table" && (
              <ChartRenderer spec={result.visualization} />
            )}

            {/* Results table */}
            {result.result_columns.length > 0 && result.result_rows.length > 0 && (
              <ResultsTable
                columns={result.result_columns}
                rows={result.result_rows}
                totalRows={result.row_count}
              />
            )}

            {/* SQL transparency (collapsible) */}
            <div style={s.sqlSection}>
              <button onClick={() => setShowSql(!showSql)} style={s.sqlToggle}>
                {showSql ? "Hide" : "Show"} generated SQL
                <span style={s.transBadge}>Transparency</span>
              </button>
              {showSql && (
                <div style={s.sqlContent}>
                  <pre style={s.sqlCode}>{result.generated_sql}</pre>
                  {result.was_modified && (
                    <div style={s.modNotice}>
                      <strong>RBAC modification:</strong>{" "}
                      {result.modification_explanation}
                    </div>
                  )}
                  {result.executed_sql && result.executed_sql !== result.generated_sql && (
                    <>
                      <div style={s.sqlLabel}>Executed SQL (after RBAC rewriting):</div>
                      <pre style={s.sqlCode}>{result.executed_sql}</pre>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Warnings */}
            {result.warnings.length > 0 && !result.bias_alert && (
              <div style={s.warningsBox}>
                {result.warnings.map((w, i) => (
                  <div key={i} style={s.warningItem}>{w}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* —— Disclaimer footer ——————————————————————————————— */}
        <footer style={s.footer}>
          AI-generated analysis of synthetic data (Synthea). Results should
          be verified by qualified professionals. Microsoft Innovation Challenge 2026.
        </footer>
      </div>
    </div>
  );
}

/* —— Styles ——————————————————————————————————————————————————— */
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
  },
  container: {
    maxWidth: 920,
    margin: "0 auto",
    padding: "20px 24px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#0f172a",
  },
  loadingPage: {
    display: "flex", alignItems: "center", justifyContent: "center",
    height: "100vh", color: "#94a3b8", fontSize: 15,
  },

  /* Header */
  header: {
    display: "flex", justifyContent: "space-between",
    alignItems: "center", marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: 700, margin: 0, color: "#0f172a" },
  subtitle: { fontSize: 12, color: "#64748b", marginTop: 2 },
  headerRight: { display: "flex", alignItems: "center", gap: 8 },
  headerBtn: {
    padding: "5px 10px", fontSize: 12,
    background: "#eff6ff", border: "1px solid #bfdbfe",
    borderRadius: 6, cursor: "pointer", color: "#1e40af",
  },
  userPill: { textAlign: "right" as const },
  userName: { fontSize: 13, fontWeight: 600, color: "#1e293b" },
  userRole: { fontSize: 11, color: "#64748b" },
  logoutBtn: {
    padding: "5px 10px", fontSize: 12,
    background: "#f1f5f9", border: "1px solid #e2e8f0",
    borderRadius: 6, cursor: "pointer", color: "#475569",
  },

  /* Impersonation */
  impBar: {
    display: "flex", alignItems: "center", gap: 8,
    marginBottom: 12, padding: "8px 12px",
    background: "#fffbeb", borderRadius: 8,
    border: "1px solid #fde68a",
  },
  impLabel: { fontSize: 12, fontWeight: 600, color: "#92400e", whiteSpace: "nowrap" as const },
  impSelect: {
    flex: 1, padding: "5px 8px", fontSize: 13,
    borderRadius: 6, border: "1px solid #fde68a",
    background: "#fff", cursor: "pointer",
  },

  /* Role badge (non-admin) */
  roleBadge: {
    marginBottom: 12, padding: "8px 14px",
    background: "#eff6ff", borderRadius: 8,
    border: "1px solid #bfdbfe", fontSize: 13,
  },

  /* Suggestions */
  suggestions: {
    display: "flex", alignItems: "center", gap: 6,
    flexWrap: "wrap" as const, marginBottom: 10,
  },
  sugLabel: { fontSize: 12, color: "#64748b" },
  sugChip: {
    padding: "5px 12px", fontSize: 12,
    background: "#fff", border: "1px solid #dbeafe",
    borderRadius: 20, cursor: "pointer", color: "#1e40af",
    transition: "background 0.1s",
  },

  /* Query input */
  inputRow: { marginBottom: 14 },
  inputWrapper: {
    display: "flex", gap: 8, alignItems: "flex-end",
    background: "#fff", borderRadius: 12,
    border: "1px solid #cbd5e1", padding: 4,
  },
  textarea: {
    flex: 1, padding: "10px 12px", fontSize: 14,
    border: "none", outline: "none", resize: "none" as const,
    fontFamily: "inherit", borderRadius: 8, background: "transparent",
  },
  submitBtn: {
    padding: "10px 22px", fontSize: 14, fontWeight: 600,
    background: "#2563eb", color: "#fff", border: "none",
    borderRadius: 8, cursor: "pointer",
    whiteSpace: "nowrap" as const,
    display: "flex", alignItems: "center", gap: 6,
  },
  spinner: {
    width: 16, height: 16, border: "2px solid #fff",
    borderTopColor: "transparent", borderRadius: "50%",
    display: "inline-block",
    animation: "spin 0.6s linear infinite",
  },

  /* Error */
  errorBox: {
    padding: "10px 14px", background: "#fef2f2",
    border: "1px solid #fecaca", borderRadius: 8,
    color: "#991b1b", fontSize: 13, marginBottom: 12,
  },

  /* Results */
  results: {
    display: "flex", flexDirection: "column" as const, gap: 10,
  },
  answerCard: {
    padding: "16px 18px", background: "#fff",
    border: "1px solid #e2e8f0", borderRadius: 10,
  },
  answerText: { fontSize: 14, lineHeight: 1.7, color: "#1e293b" },

  /* Bias */
  biasAlert: {
    padding: "10px 14px", background: "#fef3c7",
    border: "1px solid #fde68a", borderRadius: 8,
    fontSize: 13, color: "#92400e", lineHeight: 1.5,
  },

  /* Advisory */
  advisory: {
    padding: "8px 14px", borderRadius: 8,
    border: "1px solid", fontSize: 13, lineHeight: 1.5,
  },

  /* SQL section */
  sqlSection: { marginTop: 2 },
  sqlToggle: {
    padding: "6px 12px", fontSize: 12,
    background: "none", border: "1px solid #e2e8f0",
    borderRadius: 6, cursor: "pointer", color: "#475569",
    display: "flex", alignItems: "center", gap: 6,
  },
  transBadge: {
    fontSize: 10, padding: "1px 6px",
    background: "#dbeafe", color: "#1e40af",
    borderRadius: 20, fontWeight: 500,
  },
  sqlContent: {
    marginTop: 8, padding: 14,
    background: "#fff", border: "1px solid #e2e8f0",
    borderRadius: 8,
  },
  sqlLabel: {
    fontSize: 12, fontWeight: 600, color: "#475569",
    marginTop: 12, marginBottom: 4,
  },
  sqlCode: {
    background: "#1e293b", color: "#e2e8f0",
    padding: 14, borderRadius: 8, fontSize: 12,
    overflow: "auto" as const,
    whiteSpace: "pre-wrap" as const,
    fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
    margin: 0,
  },
  modNotice: {
    marginTop: 8, padding: "6px 10px",
    background: "#fffbeb", border: "1px solid #fde68a",
    borderRadius: 6, fontSize: 12, color: "#92400e",
  },

  /* Warnings */
  warningsBox: {
    padding: "8px 14px", background: "#fef2f2",
    border: "1px solid #fecaca", borderRadius: 8,
  },
  warningItem: { fontSize: 13, padding: "3px 0", color: "#991b1b" },

  /* Footer */
  footer: {
    marginTop: 28, paddingTop: 14,
    borderTop: "1px solid #e2e8f0",
    fontSize: 11, color: "#94a3b8",
    textAlign: "center" as const,
  },
};
