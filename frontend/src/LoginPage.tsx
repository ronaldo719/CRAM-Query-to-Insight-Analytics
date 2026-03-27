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
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logoMark}>Q</div>
          <h1 style={styles.title}>Query-to-Insight</h1>
          <p style={styles.subtitle}>Healthcare Analytics Engine</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              style={styles.input}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              style={styles.input}
              autoComplete="current-password"
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password.trim()}
            style={{
              ...styles.button,
              opacity: loading || !username.trim() || !password.trim() ? 0.6 : 1,
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Demo credentials toggle */}
        <div style={styles.demoSection}>
          <button
            onClick={() => setShowCredentials(!showCredentials)}
            style={styles.demoToggle}
          >
            <span style={styles.demoToggleIcon}>{showCredentials ? "▲" : "▼"}</span>
            {showCredentials ? "Hide" : "Show"} demo credentials
          </button>

          {showCredentials && (
            <>
              <p style={styles.demoHint}>Click a role to sign in instantly</p>
              <div style={styles.credentialsGrid}>
                {DEMO_ACCOUNTS.map((acct) => (
                  <button
                    key={acct.username}
                    onClick={() => quickLogin(acct.username, acct.password)}
                    style={{
                      ...styles.credentialCard,
                      borderColor: acct.borderColor,
                    }}
                    disabled={loading}
                  >
                    <div style={{ ...styles.credIconWrap, background: acct.iconBg }}>
                      <span style={styles.credIcon}>{acct.icon}</span>
                    </div>
                    <div style={styles.credInfo}>
                      <div style={styles.credName}>{acct.label}</div>
                      <div style={styles.credDesc}>{acct.desc}</div>
                    </div>
                    <span style={{ ...styles.credRolePill, background: acct.pillBg, color: acct.pillColor }}>
                      {acct.roleShort}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer disclaimer */}
        <p style={styles.disclaimer}>
          AI-powered analytics on synthetic patient data (Synthea).
          <br />
          Microsoft Innovation Challenge 2026
        </p>
      </div>
    </div>
  );
}

const DEMO_ACCOUNTS = [
  {
    username: "demo_doctor",
    password: "doctor123",
    label: "Dr. Sarah Chen",
    desc: "Query your own patient panel",
    roleShort: "Physician",
    icon: "\u{1FA7A}",
    iconBg: "#dbeafe",
    borderColor: "#93c5fd",
    pillBg: "#dbeafe",
    pillColor: "#1D6FA8",
  },
  {
    username: "demo_nurse",
    password: "nurse123",
    label: "James Rodriguez, RN",
    desc: "View department-wide patients",
    roleShort: "Nurse",
    icon: "\u{1F489}",
    iconBg: "#ccfbf1",
    borderColor: "#5eead4",
    pillBg: "#ccfbf1",
    pillColor: "#0d9488",
  },
  {
    username: "demo_billing",
    password: "billing123",
    label: "Maria Thompson",
    desc: "Financial & claims data only",
    roleShort: "Billing",
    icon: "\u{1F4B0}",
    iconBg: "#fef3c7",
    borderColor: "#fcd34d",
    pillBg: "#fef3c7",
    pillColor: "#b45309",
  },
  {
    username: "demo_researcher",
    password: "researcher123",
    label: "Dr. Alex Kumar",
    desc: "Aggregate statistics, no PII",
    roleShort: "Researcher",
    icon: "\u{1F52C}",
    iconBg: "#ede9fe",
    borderColor: "#c4b5fd",
    pillBg: "#ede9fe",
    pillColor: "#7c3aed",
  },
  {
    username: "demo_admin",
    password: "admin123",
    label: "System Admin",
    desc: "Full access + impersonation",
    roleShort: "Admin",
    icon: "\u{1F511}",
    iconBg: "#fee2e2",
    borderColor: "#fca5a5",
    pillBg: "#fee2e2",
    pillColor: "#dc2626",
  },
];

const styles: Record<string, React.CSSProperties> = {
  page: {
    position: "fixed" as const,
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "#f1f5f9",
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    zIndex: 500,
    overflowY: "auto" as const,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    background: "#fff",
    borderRadius: 16,
    padding: "36px 32px 28px",
    boxShadow: "0 4px 28px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05)",
  },
  header: { textAlign: "center" as const, marginBottom: 28 },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "#1D6FA8",
    color: "#fff",
    fontSize: 22,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 14px",
    letterSpacing: "-1px",
  },
  title: { fontSize: 22, fontWeight: 700, margin: 0, color: "#0f172a", letterSpacing: "-0.5px" },
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 4 },

  form: { display: "flex", flexDirection: "column" as const, gap: 14 },
  field: { display: "flex", flexDirection: "column" as const, gap: 5 },
  label: { fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase" as const, letterSpacing: "0.5px" },
  input: {
    padding: "10px 13px",
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    outline: "none",
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    color: "#1e293b",
    transition: "border-color 0.15s",
    background: "#f8fafc",
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
    background: "#1D6FA8",
    color: "#fff",
    border: "none",
    borderRadius: 9,
    cursor: "pointer",
    marginTop: 2,
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    letterSpacing: "0.1px",
    transition: "background 0.15s",
  },

  demoSection: {
    marginTop: 22,
    paddingTop: 18,
    borderTop: "1px solid #e2e8f0",
    textAlign: "center" as const,
  },
  demoToggle: {
    background: "none",
    border: "none",
    color: "#64748b",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontWeight: 500,
  },
  demoToggleIcon: { fontSize: 9 },
  demoHint: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 8,
    marginBottom: 10,
  },
  credentialsGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 7,
    marginTop: 4,
    textAlign: "left" as const,
  },
  credentialCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 11px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 9,
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "border-color 0.15s, background 0.15s",
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
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
  credIcon: { fontSize: 17 },
  credInfo: { flex: 1, minWidth: 0 },
  credName: { fontSize: 12, fontWeight: 600, color: "#1e293b" },
  credDesc: { fontSize: 11, color: "#64748b", marginTop: 1 },
  credRolePill: {
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
    color: "#94a3b8",
    textAlign: "center" as const,
    lineHeight: 1.5,
  },
};
