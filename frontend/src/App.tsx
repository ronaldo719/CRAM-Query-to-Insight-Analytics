import { useState } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import LoginPage from "./LoginPage";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

/*
 * App — wraps everything in AuthProvider.
 * AppContent — decides between LoginPage and QueryInterface.
 * QueryInterface — the main analytics UI (only shown when authenticated).
 */

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: 80, color: "#64748b" }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <QueryInterface />;
}

/* ── Types ──────────────────────────────────────────────────────────── */

interface QueryResult {
  answer: string;
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
  visualization: any | null;
}

/* ── Starter questions per role ─────────────────────────────────────── */

const STARTER_QUESTIONS: Record<string, string[]> = {
  physician: [
    "Show me my patients diagnosed with diabetes",
    "What medications are prescribed to my patients?",
    "How many encounters did I have this year?",
  ],
  nurse: [
    "List patients in my department with active conditions",
    "What immunizations are overdue for department patients?",
    "Show me recent vital signs for department patients",
  ],
  billing: [
    "What are the total claim costs by payer?",
    "Show me outstanding claims from last month",
    "Which encounters have the highest total costs?",
  ],
  researcher: [
    "What is the prevalence of diabetes by age group?",
    "Compare average healthcare costs across demographics",
    "What are the top 10 conditions by patient count?",
  ],
  admin: [
    "Show me all patients with diabetes and their medications",
    "What is the total revenue by organization?",
    "How many encounters by type across all providers?",
  ],
};

/* ── Main query interface ─────────────────────────────────────────── */

function QueryInterface() {
  const {
    user,
    isAdmin,
    impersonating,
    impersonatableUsers,
    setImpersonating,
    authFetch,
    logout,
  } = useAuth();

  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The active role is either the impersonated user's role or the logged-in user's role
  const activeRole = impersonating
    ? impersonatableUsers.find((u) => u.external_id === impersonating)?.role_name
    : user?.role_name;

  const activeDisplayName = impersonating
    ? impersonatableUsers.find((u) => u.external_id === impersonating)?.display_name
    : user?.display_name;

  const starters = STARTER_QUESTIONS[activeRole || "admin"] || [];

  /* ── Submit query ──────────────────────────────────────────── */
  const handleSubmit = async (q?: string) => {
    const queryText = q || question;
    if (!queryText.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await authFetch(`${API_URL}/api/query/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: queryText }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${response.status}`);
      }

      const data: QueryResult = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Failed to reach backend");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* ── Header with user info + logout ─────────────────────── */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Query-to-Insight</h1>
          <p style={styles.subtitle}>Healthcare Analytics Engine</p>
        </div>
        <div style={styles.userSection}>
          <div style={styles.userInfo}>
            <div style={styles.userName}>{user?.display_name}</div>
            <div style={styles.userRole}>{user?.role_name}</div>
          </div>
          <button onClick={logout} style={styles.logoutButton}>
            Sign out
          </button>
        </div>
      </header>

      {/* ── Admin impersonation panel ──────────────────────────── */}
      {isAdmin && impersonatableUsers.length > 0 && (
        <div style={styles.impersonationPanel}>
          <label style={styles.impLabel}>
            Viewing as:
          </label>
          <select
            value={impersonating || ""}
            onChange={(e) =>
              setImpersonating(e.target.value || null)
            }
            style={styles.impSelect}
          >
            <option value="">
              Myself (Admin — full access)
            </option>
            {impersonatableUsers
              .filter((u) => u.external_id !== user?.external_id)
              .map((u) => (
                <option key={u.external_id} value={u.external_id}>
                  {u.display_name} — {u.role_name}
                </option>
              ))}
          </select>
          {impersonating && (
            <div style={styles.impBadge}>
              Impersonating {activeDisplayName} ({activeRole})
            </div>
          )}
        </div>
      )}

      {/* ── Active role badge (non-admin users) ──────────────── */}
      {!isAdmin && (
        <div style={styles.roleBadge}>
          <div style={styles.roleBadgeName}>{user?.display_name}</div>
          <div style={styles.roleBadgeDesc}>
            Role: {user?.role_name} — {user?.row_scope}
          </div>
        </div>
      )}

      {/* ── Starter questions ──────────────────────────────────── */}
      {!result && starters.length > 0 && (
        <div style={styles.startersSection}>
          <p style={styles.startersLabel}>Try asking:</p>
          <div style={styles.startersGrid}>
            {starters.map((q, i) => (
              <button
                key={i}
                onClick={() => {
                  setQuestion(q);
                  handleSubmit(q);
                }}
                style={styles.starterButton}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Query input ─────────────────────────────────────────── */}
      <div style={styles.inputSection}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Ask a question about your healthcare data..."
          style={styles.textarea}
          rows={2}
        />
        <button
          onClick={() => handleSubmit()}
          disabled={loading || !question.trim()}
          style={{
            ...styles.submitButton,
            opacity: loading || !question.trim() ? 0.5 : 1,
          }}
        >
          {loading ? "Analyzing..." : "Ask"}
        </button>
      </div>

      {/* ── Error ─────────────────────────────────────────────────── */}
      {error && (
        <div style={styles.errorBox}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────── */}
      {result && (
        <div style={styles.resultsSection}>
          <div style={styles.answerPanel}>
            <h3 style={styles.panelTitle}>Answer</h3>
            <div style={styles.answerText}>
              {result.answer.split("\n").map((line, i) => (
                <p key={i} style={{ margin: "4px 0" }}>{line}</p>
              ))}
            </div>
            <div style={styles.metaRow}>
              <span style={styles.metaTag}>Role: {result.role_name}</span>
              <span style={styles.metaTag}>Scope: {result.access_scope}</span>
              <span style={styles.metaTag}>{result.execution_time_ms}ms</span>
              {impersonating && (
                <span style={{ ...styles.metaTag, background: "#fef3c7", color: "#92400e" }}>
                  Impersonated
                </span>
              )}
            </div>
          </div>

          <div style={styles.sqlPanel}>
            <h3 style={styles.panelTitle}>
              Generated SQL
              <span style={styles.transparencyBadge}>Transparency</span>
            </h3>
            <pre style={styles.sqlCode}>{result.generated_sql}</pre>
            {result.was_modified && (
              <div style={styles.modifiedNotice}>
                Query was modified for access control: {result.modification_explanation}
              </div>
            )}
          </div>

          {result.warnings.length > 0 && (
            <div style={styles.warningsPanel}>
              <h3 style={styles.panelTitle}>Access notices</h3>
              {result.warnings.map((w, i) => (
                <div key={i} style={styles.warningItem}>{w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <footer style={styles.footer}>
        <em>
          AI-generated analysis of synthetic data (Synthea). Results should
          be verified by qualified professionals.
        </em>
      </footer>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 860,
    margin: "0 auto",
    padding: "24px 20px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#1a1a2e",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  title: { fontSize: 26, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 2 },
  userSection: { display: "flex", alignItems: "center", gap: 12 },
  userInfo: { textAlign: "right" as const },
  userName: { fontSize: 14, fontWeight: 600 },
  userRole: { fontSize: 12, color: "#64748b" },
  logoutButton: {
    padding: "6px 14px",
    fontSize: 13,
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    cursor: "pointer",
    color: "#475569",
  },

  impersonationPanel: {
    marginBottom: 16,
    padding: 14,
    background: "#fffbeb",
    borderRadius: 10,
    border: "1px solid #fde68a",
  },
  impLabel: { fontSize: 13, fontWeight: 600, color: "#92400e", marginRight: 8 },
  impSelect: {
    width: "100%",
    padding: "8px 10px",
    fontSize: 14,
    borderRadius: 6,
    border: "1px solid #fde68a",
    background: "#fff",
    cursor: "pointer",
    marginTop: 6,
  },
  impBadge: {
    marginTop: 8,
    fontSize: 12,
    color: "#92400e",
    fontWeight: 500,
  },

  roleBadge: {
    marginBottom: 16,
    padding: "10px 14px",
    background: "#eff6ff",
    borderRadius: 8,
    border: "1px solid #bfdbfe",
  },
  roleBadgeName: { fontWeight: 600, fontSize: 14 },
  roleBadgeDesc: { fontSize: 12, color: "#64748b", marginTop: 2 },

  startersSection: { marginBottom: 20 },
  startersLabel: { fontSize: 13, color: "#64748b", marginBottom: 8 },
  startersGrid: { display: "flex", flexDirection: "column" as const, gap: 6 },
  starterButton: {
    padding: "10px 14px",
    fontSize: 14,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left" as const,
    color: "#334155",
  },

  inputSection: {
    display: "flex",
    gap: 10,
    marginBottom: 20,
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    padding: "12px 14px",
    fontSize: 15,
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    resize: "none" as const,
    fontFamily: "inherit",
    outline: "none",
  },
  submitButton: {
    padding: "12px 24px",
    fontSize: 15,
    fontWeight: 600,
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },

  errorBox: {
    padding: "12px 16px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#991b1b",
    fontSize: 14,
    marginBottom: 20,
  },

  resultsSection: { display: "flex", flexDirection: "column" as const, gap: 16 },
  answerPanel: {
    padding: 18,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 10,
  },
  panelTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#475569",
    marginTop: 0,
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  answerText: { fontSize: 15, lineHeight: 1.6 },
  metaRow: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" as const },
  metaTag: {
    fontSize: 12,
    padding: "3px 10px",
    background: "#e2e8f0",
    borderRadius: 20,
    color: "#475569",
  },

  sqlPanel: {
    padding: 18,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
  },
  transparencyBadge: {
    fontSize: 11,
    padding: "2px 8px",
    background: "#dbeafe",
    color: "#1e40af",
    borderRadius: 20,
    fontWeight: 500,
  },
  sqlCode: {
    background: "#1e293b",
    color: "#e2e8f0",
    padding: 16,
    borderRadius: 8,
    fontSize: 13,
    overflow: "auto" as const,
    whiteSpace: "pre-wrap" as const,
    fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
  },
  modifiedNotice: {
    marginTop: 10,
    padding: "8px 12px",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 6,
    fontSize: 13,
    color: "#92400e",
  },

  warningsPanel: {
    padding: 18,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 10,
  },
  warningItem: { fontSize: 14, padding: "6px 0", color: "#991b1b" },

  footer: {
    marginTop: 32,
    paddingTop: 16,
    borderTop: "1px solid #e2e8f0",
    fontSize: 12,
    color: "#94a3b8",
    textAlign: "center" as const,
  },
};
