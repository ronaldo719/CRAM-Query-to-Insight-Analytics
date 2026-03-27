import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

/*
 * AuditDashboard — admin-only Responsible AI accountability panel.
 *
 * Shows aggregate query statistics and recent denials.
 * Demonstrates the Accountability principle from Microsoft's RAI framework.
 */

interface AuditStats {
  total_queries: number;
  denied_count: number;
  modified_count: number;
  denial_rate: number;
  avg_latency_ms: number;
  max_latency_ms: number;
  avg_rows_returned: number;
  by_role: { role: string; queries: number; denied: number }[];
  recent_denials: {
    role: string; question: string; reason: string;
    user: string; timestamp: string;
  }[];
}

export default function AuditDashboard() {
  const { authFetch } = useAuth();
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/api/audit/stats`);
      if (res.ok) setStats(await res.json());
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  };

  if (loading) return <div style={s.loading}>Loading audit data...</div>;
  if (!stats) return <div style={s.loading}>Audit data unavailable</div>;

  return (
    <div style={s.wrapper}>
      <div style={s.header}>
        <h3 style={s.title}>Responsible AI audit dashboard</h3>
        <button onClick={loadStats} style={s.refreshBtn}>Refresh</button>
      </div>

      {/* Stats grid */}
      <div style={s.grid}>
        <StatCard label="Total queries" value={stats.total_queries} />
        <StatCard label="Denied" value={stats.denied_count}
          subtitle={`${stats.denial_rate}% denial rate`} color="#ef4444" />
        <StatCard label="RBAC modified" value={stats.modified_count} color="#f59e0b" />
        <StatCard label="Avg latency" value={`${stats.avg_latency_ms}ms`} />
        <StatCard label="Max latency" value={`${stats.max_latency_ms}ms`} />
        <StatCard label="Avg rows" value={stats.avg_rows_returned} />
      </div>

      {/* By role breakdown */}
      {stats.by_role.length > 0 && (
        <div style={s.section}>
          <h4 style={s.sectionTitle}>Queries by role</h4>
          <div style={s.roleGrid}>
            {stats.by_role.map((r, i) => (
              <div key={i} style={s.roleRow}>
                <span style={s.roleName}>{r.role}</span>
                <span style={s.roleCount}>{r.queries} queries</span>
                {r.denied > 0 && (
                  <span style={s.roleDenied}>{r.denied} denied</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent denials */}
      {stats.recent_denials.length > 0 && (
        <div style={s.section}>
          <h4 style={s.sectionTitle}>Recent denials</h4>
          {stats.recent_denials.map((d, i) => (
            <div key={i} style={s.denialEntry}>
              <div style={s.denialHeader}>
                <span style={s.denialUser}>{d.user}</span>
                <span style={s.denialRole}>({d.role})</span>
              </div>
              <div style={s.denialQuestion}>{d.question}</div>
              <div style={s.denialReason}>{d.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, subtitle, color }: {
  label: string; value: number | string; subtitle?: string; color?: string;
}) {
  return (
    <div style={s.statCard}>
      <div style={{ ...s.statValue, ...(color ? { color } : {}) }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div style={s.statLabel}>{label}</div>
      {subtitle && <div style={s.statSub}>{subtitle}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrapper: { padding: 16, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 16 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 14, fontWeight: 600, color: "#334155", margin: 0 },
  refreshBtn: { fontSize: 12, padding: "4px 10px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", color: "#64748b" },
  loading: { padding: 20, textAlign: "center" as const, color: "#94a3b8", fontSize: 13 },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 12 },
  statCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", textAlign: "center" as const },
  statValue: { fontSize: 20, fontWeight: 700, color: "#1e293b" },
  statLabel: { fontSize: 11, color: "#64748b", marginTop: 2 },
  statSub: { fontSize: 10, color: "#94a3b8", marginTop: 1 },

  section: { marginTop: 12, paddingTop: 12, borderTop: "1px solid #e2e8f0" },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: "#475569", margin: "0 0 8px 0" },

  roleGrid: { display: "flex", flexDirection: "column" as const, gap: 4 },
  roleRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 },
  roleName: { fontWeight: 500, color: "#334155", minWidth: 80 },
  roleCount: { color: "#64748b" },
  roleDenied: { color: "#ef4444", fontSize: 12 },

  denialEntry: { padding: "8px 0", borderBottom: "1px solid #f1f5f9" },
  denialHeader: { display: "flex", gap: 6, fontSize: 12 },
  denialUser: { fontWeight: 600, color: "#334155" },
  denialRole: { color: "#64748b" },
  denialQuestion: { fontSize: 13, color: "#1e293b", marginTop: 2 },
  denialReason: { fontSize: 12, color: "#991b1b", marginTop: 2 },
};
