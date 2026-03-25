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
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {/* Demo credentials toggle */}
        <div style={styles.demoSection}>
          <button
            onClick={() => setShowCredentials(!showCredentials)}
            style={styles.demoToggle}
          >
            {showCredentials ? "Hide" : "Show"} demo credentials
          </button>

          {showCredentials && (
            <div style={styles.credentialsGrid}>
              {DEMO_ACCOUNTS.map((acct) => (
                <button
                  key={acct.username}
                  onClick={() => quickLogin(acct.username, acct.password)}
                  style={styles.credentialRow}
                  disabled={loading}
                >
                  <span style={styles.credIcon}>{acct.icon}</span>
                  <div style={styles.credInfo}>
                    <div style={styles.credName}>{acct.label}</div>
                    <div style={styles.credRole}>{acct.role}</div>
                  </div>
                </button>
              ))}
            </div>
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
    role: "Physician — own patients",
    icon: "\u{1FA7A}", // stethoscope
  },
  {
    username: "demo_nurse",
    password: "nurse123",
    label: "James Rodriguez, RN",
    role: "Nurse — department patients",
    icon: "\u{1F489}", // syringe
  },
  {
    username: "demo_billing",
    password: "billing123",
    label: "Maria Thompson",
    role: "Billing — financial only",
    icon: "\u{1F4B0}", // money bag
  },
  {
    username: "demo_researcher",
    password: "researcher123",
    label: "Dr. Alex Kumar",
    role: "Researcher — aggregates only",
    icon: "\u{1F52C}", // microscope
  },
  {
    username: "demo_admin",
    password: "admin123",
    label: "System Admin",
    role: "Admin — full access + impersonation",
    icon: "\u{1F511}", // key
  },
];

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "#f1f5f9",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "#fff",
    borderRadius: 16,
    padding: "36px 32px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
  },
  header: { textAlign: "center" as const, marginBottom: 28 },
  title: { fontSize: 26, fontWeight: 700, margin: 0, color: "#0f172a" },
  subtitle: { fontSize: 14, color: "#64748b", marginTop: 4 },

  form: { display: "flex", flexDirection: "column" as const, gap: 16 },
  field: { display: "flex", flexDirection: "column" as const, gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: "#475569" },
  input: {
    padding: "10px 14px",
    fontSize: 15,
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    outline: "none",
    transition: "border-color 0.15s",
  },
  error: {
    padding: "10px 14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#991b1b",
    fontSize: 14,
  },
  button: {
    padding: "12px 0",
    fontSize: 15,
    fontWeight: 600,
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    marginTop: 4,
  },

  demoSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTop: "1px solid #e2e8f0",
    textAlign: "center" as const,
  },
  demoToggle: {
    background: "none",
    border: "none",
    color: "#64748b",
    fontSize: 13,
    cursor: "pointer",
    textDecoration: "underline",
  },
  credentialsGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    marginTop: 12,
  },
  credentialRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "border-color 0.15s",
  },
  credIcon: { fontSize: 20 },
  credInfo: { flex: 1 },
  credName: { fontSize: 13, fontWeight: 600, color: "#1e293b" },
  credRole: { fontSize: 11, color: "#64748b" },

  disclaimer: {
    marginTop: 24,
    fontSize: 11,
    color: "#94a3b8",
    textAlign: "center" as const,
    lineHeight: 1.5,
  },
};
