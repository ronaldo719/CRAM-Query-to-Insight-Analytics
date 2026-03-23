import { useState, useEffect } from "react";

/*
 * Query-to-Insight Frontend — Day 1 Scaffold
 *
 * This single component proves the full end-to-end loop:
 *   1. User selects a role from the dropdown
 *   2. User types a natural language question
 *   3. Frontend sends the question + role header to the FastAPI backend
 *   4. Backend calls Azure OpenAI, generates SQL, and returns a response
 *   5. Frontend displays the answer, generated SQL, and role context
 *
 * On Day 2-3, this will be split into proper components:
 *   - RoleSwitcher, QueryInput, SQLPanel, ResultsTable, VisualizationPanel
 *
 * For now, everything lives here so the team can see the full picture
 * in one file and start iterating.
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

/* ── TypeScript-style shapes (using JSDoc for plain JS) ─────────── */

interface Role {
  id: string;
  label: string;
  icon: string;
  description: string;
}

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

/* ── Role icon mapping (using emoji for Day 1, swap for Lucide on Day 3) ── */
const ROLE_ICONS: Record<string, string> = {
  stethoscope: "🩺",
  "heart-pulse": "💉",
  receipt: "💰",
  microscope: "🔬",
  shield: "🔑",
};

/* ── Starter questions for each role ─────────────────────────────── */
const STARTER_QUESTIONS: Record<string, string[]> = {
  demo_doctor: [
    "Show me my patients diagnosed with diabetes",
    "What medications are prescribed to my patients?",
    "How many encounters did I have this year?",
  ],
  demo_nurse: [
    "List all patients in my department with active conditions",
    "What immunizations are overdue for department patients?",
    "Show me recent vital signs for department patients",
  ],
  demo_billing: [
    "What are the total claim costs by payer?",
    "Show me outstanding claims from last month",
    "Which encounters have the highest total costs?",
  ],
  demo_researcher: [
    "What is the prevalence of diabetes by age group and gender?",
    "Compare average healthcare costs across racial demographics",
    "What are the top 10 conditions by patient count?",
  ],
  demo_admin: [
    "Show me all patients with diabetes and their medications",
    "What is the total revenue by organization?",
    "How many encounters by type across all providers?",
  ],
};

export default function App() {
  /* ── State ──────────────────────────────────────────────────── */
  const [roles, setRoles] = useState<Role[]>([]);
  const [currentRole, setCurrentRole] = useState("demo_admin");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");

  /* ── On mount: check backend health + load roles ────────────── */
  useEffect(() => {
    // Health check
    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then(() => setBackendStatus("online"))
      .catch(() => setBackendStatus("offline"));

    // Load roles for the dropdown
    fetch(`${API_URL}/api/query/roles`)
      .then((res) => res.json())
      .then((data) => setRoles(data.roles))
      .catch(() => {
        // Fallback roles if backend is down
        setRoles([
          {
            id: "demo_admin",
            label: "System Admin",
            icon: "shield",
            description: "Full access",
          },
        ]);
      });
  }, []);

  /* ── Submit question to backend ─────────────────────────────── */
  const handleSubmit = async (q?: string) => {
    const queryText = q || question;
    if (!queryText.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${API_URL}/api/query/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": currentRole,
        },
        body: JSON.stringify({ question: queryText }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: QueryResult = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Failed to reach backend");
    } finally {
      setLoading(false);
    }
  };

  const selectedRole = roles.find((r) => r.id === currentRole);
  const starters = STARTER_QUESTIONS[currentRole] || [];

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div style={styles.container}>
      {/* ── Header ────────────────────────────────────────────── */}
      <header style={styles.header}>
        <h1 style={styles.title}>Query-to-Insight</h1>
        <p style={styles.subtitle}>
          Healthcare Analytics Engine — Microsoft Innovation Challenge
        </p>
        <div style={styles.statusRow}>
          <span
            style={{
              ...styles.statusDot,
              backgroundColor:
                backendStatus === "online"
                  ? "#22c55e"
                  : backendStatus === "offline"
                    ? "#ef4444"
                    : "#eab308",
            }}
          />
          <span style={styles.statusText}>
            Backend:{" "}
            {backendStatus === "checking"
              ? "connecting..."
              : backendStatus === "online"
                ? "online"
                : "offline — start with: uvicorn app.main:app --reload"}
          </span>
        </div>
      </header>

      {/* ── Role Switcher ─────────────────────────────────────── */}
      <div style={styles.roleSection}>
        <label style={styles.roleLabel}>Viewing as:</label>
        <select
          value={currentRole}
          onChange={(e) => {
            setCurrentRole(e.target.value);
            setResult(null);
          }}
          style={styles.roleSelect}
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {ROLE_ICONS[role.icon] || "👤"} {role.label}
            </option>
          ))}
        </select>
        {selectedRole && (
          <div style={styles.roleBadge}>
            <span style={styles.roleBadgeIcon}>
              {ROLE_ICONS[selectedRole.icon] || "👤"}
            </span>
            <div>
              <div style={styles.roleBadgeName}>{selectedRole.label}</div>
              <div style={styles.roleBadgeDesc}>{selectedRole.description}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Starter Questions ─────────────────────────────────── */}
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

      {/* ── Query Input ───────────────────────────────────────── */}
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

      {/* ── Error Display ─────────────────────────────────────── */}
      {error && (
        <div style={styles.errorBox}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────── */}
      {result && (
        <div style={styles.resultsSection}>
          {/* Answer panel */}
          <div style={styles.answerPanel}>
            <h3 style={styles.panelTitle}>Answer</h3>
            <div style={styles.answerText}>
              {result.answer.split("\n").map((line, i) => (
                <p key={i} style={{ margin: "4px 0" }}>
                  {line}
                </p>
              ))}
            </div>
            <div style={styles.metaRow}>
              <span style={styles.metaTag}>
                Role: {result.role_name}
              </span>
              <span style={styles.metaTag}>
                Scope: {result.access_scope}
              </span>
              <span style={styles.metaTag}>
                {result.execution_time_ms}ms
              </span>
            </div>
          </div>

          {/* SQL Transparency panel (Responsible AI) */}
          <div style={styles.sqlPanel}>
            <h3 style={styles.panelTitle}>
              Generated SQL
              <span style={styles.transparencyBadge}>Transparency</span>
            </h3>
            <pre style={styles.sqlCode}>{result.generated_sql}</pre>
            {result.was_modified && (
              <div style={styles.modifiedNotice}>
                ⚠️ Query was modified for access control:{" "}
                {result.modification_explanation}
              </div>
            )}
          </div>

          {/* Warnings / Access denials */}
          {result.warnings.length > 0 && (
            <div style={styles.warningsPanel}>
              <h3 style={styles.panelTitle}>Access Notices</h3>
              {result.warnings.map((w, i) => (
                <div key={i} style={styles.warningItem}>
                  🔒 {w}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer style={styles.footer}>
        <em>
          AI-generated analysis of synthetic data (Synthea). Results should
          be verified by qualified professionals.
        </em>
      </footer>
    </div>
  );
}

/* ── Inline styles (swap for Tailwind or CSS modules on Day 3) ──── */
const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 860,
    margin: "0 auto",
    padding: "24px 20px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#1a1a2e",
  },
  header: { marginBottom: 28 },
  title: { fontSize: 28, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 14, color: "#64748b", marginTop: 4 },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
  },
  statusText: { fontSize: 13, color: "#64748b" },

  roleSection: {
    marginBottom: 20,
    padding: 16,
    background: "#f8fafc",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
  },
  roleLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    display: "block",
    marginBottom: 8,
  },
  roleSelect: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 15,
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#fff",
    cursor: "pointer",
    marginBottom: 10,
  },
  roleBadge: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    background: "#eff6ff",
    borderRadius: 8,
    border: "1px solid #bfdbfe",
  },
  roleBadgeIcon: { fontSize: 22 },
  roleBadgeName: { fontWeight: 600, fontSize: 14 },
  roleBadgeDesc: { fontSize: 12, color: "#64748b" },

  startersSection: { marginBottom: 20 },
  startersLabel: { fontSize: 13, color: "#64748b", marginBottom: 8 },
  startersGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  starterButton: {
    padding: "10px 14px",
    fontSize: 14,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left" as const,
    color: "#334155",
    transition: "border-color 0.15s",
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

  resultsSection: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
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
  metaRow: {
    display: "flex",
    gap: 8,
    marginTop: 12,
    flexWrap: "wrap" as const,
  },
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
  warningItem: {
    fontSize: 14,
    padding: "6px 0",
    color: "#991b1b",
  },

  footer: {
    marginTop: 32,
    paddingTop: 16,
    borderTop: "1px solid #e2e8f0",
    fontSize: 12,
    color: "#94a3b8",
    textAlign: "center" as const,
  },
};
