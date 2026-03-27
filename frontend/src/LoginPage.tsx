import { useState } from "react";
import { useAuth } from "./AuthContext";

/*
 * LoginPage — the entry point for all users.
 *
 * Clean, professional login form that authenticates against the
 * FastAPI backend. On success, the JWT token is stored and the
 * user is redirected to the main query interface.
 *
 * For the demo, credentials are displayed in a hint box so judges
 * can quickly try different roles without memorizing passwords.
 */

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setLoading(true);
    setError(null);

    try {
      await login(username.trim(), password.trim());
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // Quick-fill for demo convenience
  const quickLogin = async (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
    setLoading(true);
    setError(null);
    try {
      await login(user, pass);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      {/* ── Left dark panel ────────────────────────────────────── */}
      <div style={s.leftPanel}>
        <div style={s.leftContent}>
          <div style={s.logoMark}>Q</div>
          <h1 style={s.leftTitle}>Query-to-Insight</h1>
          <p style={s.leftSub}>Healthcare Analytics Engine</p>

          <div style={s.featureList}>
            {FEATURES.map((f, i) => (
              <div key={i} style={s.featureItem}>
                <span style={s.featureIcon}>{f.icon}</span>
                <div>
                  <div style={s.featureTitle}>{f.title}</div>
                  <div style={s.featureDesc}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p style={s.leftFooter}>Microsoft Innovation Challenge 2026</p>
      </div>

      {/* ── Right white form panel ─────────────────────────────── */}
      <div style={s.rightPanel}>
        <div style={s.formWrap}>
          <div style={s.formHeader}>
            <h2 style={s.formTitle}>Sign in</h2>
            <p style={s.formSub}>Access your healthcare analytics dashboard</p>
          </div>

          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.field}>
              <label style={s.label}>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                style={s.input}
                autoComplete="username"
                autoFocus
              />
            </div>

            <div style={s.field}>
              <label style={s.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                style={s.input}
                autoComplete="current-password"
              />
            </div>

            {error && <div style={s.error}>{error}</div>}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password.trim()}
              style={{
                ...s.button,
                opacity: loading || !username.trim() || !password.trim() ? 0.55 : 1,
              }}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {/* Demo credentials */}
          <div style={s.demoSection}>
            <button
              onClick={() => setShowCredentials(!showCredentials)}
              style={s.demoToggle}
            >
              {showCredentials ? "▲" : "▼"} {showCredentials ? "Hide" : "Show"} demo accounts
            </button>

            {showCredentials && (
              <div style={s.credGrid}>
                {DEMO_ACCOUNTS.map((acct) => (
                  <button
                    key={acct.username}
                    onClick={() => quickLogin(acct.username, acct.password)}
                    style={s.credCard}
                    disabled={loading}
                  >
                    <div style={{ ...s.credIconWrap, background: acct.iconBg }}>
                      <span style={s.credIcon}>{acct.icon}</span>
                    </div>
                    <div style={s.credInfo}>
                      <div style={s.credName}>{acct.label}</div>
                      <div style={s.credDesc}>{acct.desc}</div>
                    </div>
                    <span style={{ ...s.credPill, background: acct.pillBg, color: acct.pillColor }}>
                      {acct.roleShort}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <p style={s.disclaimer}>
            AI-powered analytics on synthetic patient data (Synthea).
          </p>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: "🔍", title: "Natural Language Queries", desc: "Ask questions in plain English, get instant insights" },
  { icon: "🔐", title: "Role-Based Access Control", desc: "Data scoped automatically to your permissions" },
  { icon: "⚖️", title: "Responsible AI", desc: "Bias detection, sensitivity classification & SQL transparency" },
  { icon: "📊", title: "Audit Trail", desc: "Every query logged for compliance and oversight" },
];

const DEMO_ACCOUNTS = [
  {
    username: "demo_doctor",
    password: "doctor123",
    label: "Dr. Sarah Chen",
    desc: "Own patient panel",
    roleShort: "Physician",
    icon: "\u{1FA7A}",
    iconBg: "#dbeafe",
    pillBg: "#dbeafe",
    pillColor: "#1d4ed8",
  },
  {
    username: "demo_nurse",
    password: "nurse123",
    label: "James Rodriguez, RN",
    desc: "Department patients",
    roleShort: "Nurse",
    icon: "\u{1F489}",
    iconBg: "#d1fae5",
    pillBg: "#d1fae5",
    pillColor: "#065f46",
  },
  {
    username: "demo_billing",
    password: "billing123",
    label: "Maria Thompson",
    desc: "Financial data only",
    roleShort: "Billing",
    icon: "\u{1F4B0}",
    iconBg: "#fef3c7",
    pillBg: "#fef3c7",
    pillColor: "#92400e",
  },
  {
    username: "demo_researcher",
    password: "researcher123",
    label: "Dr. Alex Kumar",
    desc: "Aggregates, no PII",
    roleShort: "Researcher",
    icon: "\u{1F52C}",
    iconBg: "#ede9fe",
    pillBg: "#ede9fe",
    pillColor: "#5b21b6",
  },
  {
    username: "demo_admin",
    password: "admin123",
    label: "System Admin",
    desc: "Full access + impersonation",
    roleShort: "Admin",
    icon: "\u{1F511}",
    iconBg: "#fee2e2",
    pillBg: "#fee2e2",
    pillColor: "#991b1b",
  },
];

const s: Record<string, React.CSSProperties> = {
  page: {
    position: "fixed" as const,
    inset: 0,
    display: "flex",
    fontFamily: "'Inter', system-ui, sans-serif",
    zIndex: 500,
  },

  /* Left panel */
  leftPanel: {
    width: "42%",
    background: "#111827",
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "space-between",
    padding: "48px 40px",
    flexShrink: 0,
  },
  leftContent: { flex: 1 },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "#6366f1",
    color: "#fff",
    fontSize: 22,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    letterSpacing: "-1px",
  },
  leftTitle: {
    fontSize: 28,
    fontWeight: 700,
    color: "#f9fafb",
    margin: "0 0 8px",
    letterSpacing: "-0.5px",
  },
  leftSub: {
    fontSize: 14,
    color: "#6b7280",
    margin: "0 0 40px",
  },
  featureList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 24,
  },
  featureItem: {
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
  },
  featureIcon: {
    fontSize: 20,
    width: 36,
    height: 36,
    background: "rgba(99,102,241,0.15)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  featureTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#f3f4f6",
    marginBottom: 3,
  },
  featureDesc: {
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 1.5,
  },
  leftFooter: {
    fontSize: 11,
    color: "#4b5563",
    margin: 0,
  },

  /* Right panel */
  rightPanel: {
    flex: 1,
    background: "#f9fafb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflowY: "auto" as const,
    padding: "32px 24px",
  },
  formWrap: {
    width: "100%",
    maxWidth: 400,
  },
  formHeader: { marginBottom: 28 },
  formTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "#111827",
    margin: "0 0 6px",
    letterSpacing: "-0.4px",
  },
  formSub: { fontSize: 13, color: "#6b7280", margin: 0 },

  form: { display: "flex", flexDirection: "column" as const, gap: 14 },
  field: { display: "flex", flexDirection: "column" as const, gap: 5 },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "#374151",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  input: {
    padding: "10px 13px",
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid #d1d5db",
    outline: "none",
    fontFamily: "'Inter', system-ui, sans-serif",
    color: "#111827",
    background: "#ffffff",
    transition: "border-color 0.15s, box-shadow 0.15s",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },
  error: {
    padding: "9px 12px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#991b1b",
    fontSize: 13,
  },
  button: {
    padding: "11px 0",
    fontSize: 14,
    fontWeight: 600,
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 9,
    cursor: "pointer",
    marginTop: 4,
    fontFamily: "'Inter', system-ui, sans-serif",
    transition: "background 0.12s",
    boxShadow: "0 2px 8px rgba(99,102,241,0.3)",
  },

  demoSection: {
    marginTop: 24,
    paddingTop: 18,
    borderTop: "1px solid #e5e7eb",
    textAlign: "center" as const,
  },
  demoToggle: {
    background: "none",
    border: "none",
    color: "#6b7280",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "'Inter', system-ui, sans-serif",
    fontWeight: 500,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },
  credGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    marginTop: 12,
    textAlign: "left" as const,
  },
  credCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 11px",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 9,
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "border-color 0.12s, box-shadow 0.12s",
    fontFamily: "'Inter', system-ui, sans-serif",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },
  credIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  credIcon: { fontSize: 16 },
  credInfo: { flex: 1, minWidth: 0 },
  credName: { fontSize: 12, fontWeight: 600, color: "#111827" },
  credDesc: { fontSize: 11, color: "#6b7280", marginTop: 1 },
  credPill: {
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 20,
    flexShrink: 0,
    letterSpacing: "0.2px",
  },

  disclaimer: {
    marginTop: 20,
    fontSize: 11,
    color: "#9ca3af",
    textAlign: "center" as const,
    lineHeight: 1.5,
  },
};
