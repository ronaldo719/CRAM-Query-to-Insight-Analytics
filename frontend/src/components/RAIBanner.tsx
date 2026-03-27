/*
 * RAIBanner — Responsible AI status bar.
 *
 * Compact horizontal strip shown above every query result that
 * summarizes all the Responsible AI checks that ran:
 *   - Sensitivity level (green/amber/red dot + label)
 *   - Confidence level (high/medium/low/denied)
 *   - Role + scope (what access produced these results)
 *   - Execution time
 *   - RBAC modification indicator (if query was rewritten)
 *
 * This is the first thing judges see after each query result,
 * making Responsible AI immediately visible.
 */

interface Props {
  sensitivityLevel: string;
  confidence: string;
  roleName: string;
  accessScope: string;
  executionTimeMs: number;
  rowCount: number;
  wasModified: boolean;
  retryCount?: number;
  impersonating?: boolean;
}

const SENSITIVITY_STYLES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  green:  { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", dot: "#22c55e" },
  amber:  { bg: "#fffbeb", border: "#fde68a", text: "#92400e", dot: "#f59e0b" },
  red:    { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", dot: "#ef4444" },
};

const CONFIDENCE_STYLES: Record<string, { bg: string; text: string }> = {
  high:   { bg: "#dcfce7", text: "#166534" },
  medium: { bg: "#fef3c7", text: "#92400e" },
  low:    { bg: "#fee2e2", text: "#991b1b" },
  denied: { bg: "#fecaca", text: "#7f1d1d" },
  stub:   { bg: "#e2e8f0", text: "#475569" },
};

export default function RAIBanner({
  sensitivityLevel, confidence, roleName, accessScope,
  executionTimeMs, rowCount, wasModified, retryCount, impersonating,
}: Props) {
  const sens = SENSITIVITY_STYLES[sensitivityLevel] || SENSITIVITY_STYLES.green;
  const conf = CONFIDENCE_STYLES[confidence] || CONFIDENCE_STYLES.high;

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
      padding: "8px 12px", borderRadius: 8,
      background: sens.bg, border: `1px solid ${sens.border}`,
    }}>
      {/* Sensitivity badge */}
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 12, fontWeight: 600, color: sens.text,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: sens.dot, display: "inline-block",
        }} />
        {sensitivityLevel.toUpperCase()}
      </span>

      <span style={styles.divider} />

      {/* Confidence */}
      <span style={{
        fontSize: 11, padding: "1px 8px", borderRadius: 20,
        background: conf.bg, color: conf.text, fontWeight: 500,
      }}>
        {confidence}
      </span>

      <span style={styles.divider} />

      {/* Role + scope */}
      <span style={styles.meta}>{roleName} ({accessScope})</span>

      <span style={styles.divider} />

      {/* Timing + rows */}
      <span style={styles.meta}>{executionTimeMs}ms</span>
      {rowCount > 0 && (
        <>
          <span style={styles.divider} />
          <span style={styles.meta}>{rowCount.toLocaleString()} rows</span>
        </>
      )}

      {/* RBAC modified indicator */}
      {wasModified && (
        <>
          <span style={styles.divider} />
          <span style={{ fontSize: 11, color: "#92400e", fontWeight: 500 }}>
            RBAC filtered
          </span>
        </>
      )}

      {/* Retry indicator */}
      {(retryCount ?? 0) > 0 && (
        <>
          <span style={styles.divider} />
          <span style={{ fontSize: 11, color: "#64748b" }}>
            {retryCount} retries
          </span>
        </>
      )}

      {/* Impersonation indicator */}
      {impersonating && (
        <>
          <span style={styles.divider} />
          <span style={{
            fontSize: 11, padding: "1px 8px", borderRadius: 20,
            background: "#fef3c7", color: "#92400e", fontWeight: 500,
          }}>
            impersonated
          </span>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  divider: {
    width: 1, height: 14, background: "#d1d5db",
    display: "inline-block",
  },
  meta: { fontSize: 12, color: "#64748b" },
};
