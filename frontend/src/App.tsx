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
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState<{ question: string; answer: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
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
    setLastQuestion(text);
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
      const data = await res.json();
      setResult(data);
      setHistory(prev => [...prev, { question: text, answer: data.answer }]);
      setQuestion("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const initials = (user?.display_name || "?")
    .split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div style={s.page}>
      {/* —— Sidebar ——————————————————————————————————————————— */}
      <aside style={s.sidebar}>
        {/* Logo */}
        <div style={s.sidebarLogo}>
          <div style={s.sidebarTitle}>Query-to-Insight</div>
          <div style={s.sidebarSubtitle}>Healthcare Analytics</div>
        </div>

        <div style={s.sidebarDivider} />

        {/* User card */}
        <div style={s.sidebarUserCard}>
          <div style={s.sidebarAvatar}>{initials}</div>
          <div style={s.sidebarUserInfo}>
            <div style={s.sidebarUserName}>{user?.display_name}</div>
            <div style={s.sidebarUserRole}>{user?.role_name}</div>
          </div>
        </div>

        {/* Access scope */}
        <div style={s.sidebarMeta}>
          <span style={s.sidebarMetaLabel}>Access scope</span>
          <span style={s.sidebarMetaValue}>{(user as any)?.row_scope || "standard"}</span>
        </div>

        <div style={s.sidebarDivider} />

        {/* Admin: impersonation */}
        {isAdmin && impersonatableUsers.length > 0 && (
          <div style={s.sidebarSection}>
            <div style={s.sidebarSectionLabel}>Viewing as</div>
            <select
              value={impersonating || ""}
              onChange={e => handleRoleSwitch(e.target.value || null)}
              style={s.sidebarSelect}
            >
              <option value="">Myself (Admin)</option>
              {impersonatableUsers
                .filter(u => u.external_id !== user?.external_id)
                .map(u => (
                  <option key={u.external_id} value={u.external_id}>
                    {u.display_name} — {u.role_name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Admin: audit */}
        {isAdmin && (
          <button onClick={() => setShowAudit(!showAudit)} style={s.sidebarBtn}>
            {showAudit ? "Hide" : "View"} Audit Dashboard
          </button>
        )}

        {/* Chat history */}
        {history.length > 0 && (
          <div style={s.sidebarSection}>
            <button onClick={() => setShowHistory(!showHistory)} style={s.historyToggle}>
              <span>{showHistory ? "▾" : "▸"} Chat history</span>
              <span style={s.historyCount}>{history.length}</span>
            </button>
            {showHistory && (
              <div style={s.historyList}>
                {history.map((item, i) => (
                  <div key={i} style={s.historyItem}>
                    <div style={s.historyQ}>{item.question}</div>
                    <div style={s.historyA}>{item.answer}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sign out */}
        <div style={s.sidebarBottom}>
          <button onClick={logout} style={s.logoutBtn}>Sign out</button>
        </div>
      </aside>

      {/* —— Main content —————————————————————————————————————— */}
      <div style={s.main}>
        {/* Audit dashboard */}
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
              {loading ? <span style={s.spinner} /> : "Ask"}
            </button>
          </div>
        </div>

        {/* —— Current question display ————————————————————————— */}
        {lastQuestion && (
          <div style={s.currentQueryBox}>
            <span style={s.currentQueryLabel}>Current question:</span>
            <p style={s.currentQueryCode}>{lastQuestion}</p>
          </div>
        )}

        {/* —— Error ——————————————————————————————————————————— */}
        {error && (
          <div style={s.errorBox}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* —— Results ————————————————————————————————————————— */}
        {result && (
          <div style={s.results}>
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

            <div style={s.answerCard}>
              <div style={s.answerText}>
                {result.answer.split("\n").map((line, i) => (
                  <p key={i} style={{ margin: "3px 0" }}>{line}</p>
                ))}
              </div>
            </div>

            {result.bias_alert && (
              <div style={s.biasAlert}>
                <strong>Fairness notice:</strong> {result.bias_alert}
              </div>
            )}

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

            {result.result_columns.length > 0 && result.result_rows.length > 0 && (
              <ResultsTable
                columns={result.result_columns}
                rows={result.result_rows}
                totalRows={result.row_count}
              />
            )}

            {result.visualization && result.visualization.chartType !== "table" && (
              <ChartRenderer spec={result.visualization} />
            )}

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

            {result.warnings.length > 0 && !result.bias_alert && (
              <div style={s.warningsBox}>
                {result.warnings.map((w, i) => (
                  <div key={i} style={s.warningItem}>{w}</div>
                ))}
              </div>
            )}
          </div>
        )}

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
    display: "flex", minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#0f172a",
  },
  loadingPage: {
    display: "flex", alignItems: "center", justifyContent: "center",
    height: "100vh", color: "#94a3b8", fontSize: 15,
  },

  /* —— Sidebar —— */
  sidebar: {
    width: 240, flexShrink: 0,
    background: "#1e1b4b",
    display: "flex", flexDirection: "column" as const,
    padding: "24px 16px",
    minHeight: "100vh",
    position: "sticky" as const, top: 0, alignSelf: "flex-start" as const,
    height: "100vh", overflowY: "auto" as const,
  },
  sidebarLogo: { marginBottom: 4 },
  sidebarTitle: {
    fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em",
  },
  sidebarSubtitle: {
    fontSize: 11, color: "#a5b4fc", marginTop: 2,
  },
  sidebarDivider: {
    height: 1, background: "rgba(165,180,252,0.15)",
    margin: "16px 0",
  },
  sidebarUserCard: {
    display: "flex", alignItems: "center", gap: 10,
    marginBottom: 12,
  },
  sidebarAvatar: {
    width: 36, height: 36, borderRadius: "50%",
    background: "#6366f1", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, fontWeight: 700, flexShrink: 0,
  },
  sidebarUserInfo: { minWidth: 0 },
  sidebarUserName: {
    fontSize: 13, fontWeight: 600, color: "#fff",
    whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis",
  },
  sidebarUserRole: { fontSize: 11, color: "#a5b4fc" },
  sidebarMeta: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 4,
  },
  sidebarMetaLabel: { fontSize: 11, color: "#818cf8" },
  sidebarMetaValue: {
    fontSize: 11, fontWeight: 600, color: "#c7d2fe",
    background: "rgba(99,102,241,0.2)", padding: "1px 8px",
    borderRadius: 20,
  },
  sidebarSection: { marginBottom: 12 },
  sidebarSectionLabel: {
    fontSize: 10, fontWeight: 600, color: "#818cf8",
    textTransform: "uppercase" as const, letterSpacing: "0.06em",
    marginBottom: 6,
  },
  sidebarSelect: {
    width: "100%", padding: "6px 8px", fontSize: 12,
    borderRadius: 6, border: "1px solid rgba(165,180,252,0.3)",
    background: "rgba(255,255,255,0.07)", color: "#e0e7ff",
    cursor: "pointer",
  },
  sidebarBtn: {
    width: "100%", padding: "8px 12px", fontSize: 12, fontWeight: 500,
    background: "rgba(99,102,241,0.25)", color: "#c7d2fe",
    border: "1px solid rgba(99,102,241,0.4)",
    borderRadius: 8, cursor: "pointer", marginBottom: 12,
    textAlign: "left" as const,
  },
  sidebarBottom: { marginTop: "auto", paddingTop: 16 },
  logoutBtn: {
    width: "100%", padding: "8px 12px", fontSize: 12,
    background: "rgba(255,255,255,0.06)", color: "#94a3b8",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8, cursor: "pointer",
  },

  /* Chat history (inside sidebar) */
  historyToggle: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    width: "100%", padding: "6px 0", fontSize: 12, fontWeight: 600,
    background: "none", border: "none",
    cursor: "pointer", color: "#a5b4fc",
    marginBottom: 6,
  },
  historyCount: {
    fontSize: 10, padding: "1px 6px",
    background: "rgba(99,102,241,0.35)", color: "#c7d2fe",
    borderRadius: 20, fontWeight: 500,
  },
  historyList: {
    display: "flex", flexDirection: "column" as const,
    gap: 6, maxHeight: 260, overflowY: "auto" as const,
  },
  historyItem: {
    padding: "8px 10px",
    background: "rgba(255,255,255,0.06)",
    borderRadius: 6,
    border: "1px solid rgba(165,180,252,0.15)",
  },
  historyQ: {
    fontSize: 11, fontWeight: 600, color: "#c7d2fe", marginBottom: 3,
  },
  historyA: {
    fontSize: 11, color: "#94a3b8", lineHeight: 1.4,
  },

  /* —— Main content —— */
  main: {
    flex: 1, padding: "28px 32px", maxWidth: 860,
    display: "flex", flexDirection: "column" as const,
  },

  /* Suggestions */
  suggestions: {
    display: "flex", alignItems: "center", gap: 6,
    flexWrap: "wrap" as const, marginBottom: 12,
  },
  sugLabel: { fontSize: 12, color: "#64748b" },
  sugChip: {
    padding: "5px 12px", fontSize: 12,
    background: "#fff", border: "1px solid #dbeafe",
    borderRadius: 20, cursor: "pointer", color: "#1e40af",
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
    background: "#6366f1", color: "#fff", border: "none",
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

  /* Current query */
  currentQueryBox: {
    marginBottom: 10, padding: "10px 16px",
    background: "#fff", borderRadius: 8,
    border: "1px solid #e2e8f0",
    borderLeft: "4px solid #6366f1",
  },
  currentQueryLabel: {
    fontSize: 10, fontWeight: 600, color: "#6366f1",
    textTransform: "uppercase" as const, letterSpacing: "0.06em",
    display: "block", marginBottom: 4,
  },
  currentQueryCode: {
    margin: 0, fontSize: 13, color: "#1e293b",
    lineHeight: 1.5, fontStyle: "italic",
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
    background: "#ede9fe", color: "#6366f1",
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
