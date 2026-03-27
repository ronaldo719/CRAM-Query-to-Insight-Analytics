import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

/*
 * ChartRenderer — auto-visualization engine.
 *
 * The backend's QueryEngine generates a JSON chart specification:
 *   { chartType, xKey, yKey, title, data: [{...}, ...] }
 *
 * This component receives that spec and renders the appropriate
 * Recharts component. The chart type was chosen by GPT-4o-mini
 * based on the shape of the query results:
 *   - bar: categories + counts (most common)
 *   - line: time series data
 *   - pie: proportions (≤8 slices)
 *   - scatter: two numeric columns
 *   - table: fallback when no chart fits
 */

interface ChartSpec {
  chartType: "bar" | "line" | "pie" | "scatter" | "table";
  xKey: string;
  yKey: string;
  title?: string;
  data: Record<string, any>[];
}

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];

export default function ChartRenderer({ spec }: { spec: ChartSpec }) {
  if (!spec || !spec.data || spec.data.length === 0) return null;

  const { chartType, xKey, yKey, title, data } = spec;

  // Ensure numeric values are actually numbers (backend sends strings)
  const cleanData = data.map((row) => {
    const cleaned: Record<string, any> = { ...row };
    if (yKey && cleaned[yKey] !== undefined) {
      const num = Number(cleaned[yKey]);
      if (!isNaN(num)) cleaned[yKey] = num;
    }
    // Also clean any other numeric-looking values
    Object.keys(cleaned).forEach((key) => {
      if (key !== xKey && typeof cleaned[key] === "string") {
        const num = Number(cleaned[key]);
        if (!isNaN(num) && cleaned[key].trim() !== "") cleaned[key] = num;
      }
    });
    return cleaned;
  });

  return (
    <div style={styles.wrapper}>
      {title && <h4 style={styles.title}>{title}</h4>}
      <div style={styles.chartContainer}>
        {chartType === "bar" && (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={cleanData} margin={{ top: 8, right: 20, left: 10, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey={xKey}
                tick={{ fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                interval={0}
                height={80}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={styles.tooltip}
                formatter={(value: number) =>
                  typeof value === "number" ? value.toLocaleString() : value
                }
              />
              <Bar dataKey={yKey} fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}

        {chartType === "line" && (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={cleanData} margin={{ top: 8, right: 20, left: 10, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey={xKey}
                tick={{ fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                height={80}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={styles.tooltip} />
              <Line
                type="monotone"
                dataKey={yKey}
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}

        {chartType === "pie" && (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={cleanData}
                dataKey={yKey}
                nameKey={xKey}
                cx="50%"
                cy="50%"
                outerRadius={120}
                label={({ name, percent }) =>
                  `${name}: ${(percent * 100).toFixed(0)}%`
                }
                labelLine={{ strokeWidth: 1 }}
              >
                {cleanData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={styles.tooltip} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}

        {chartType === "scatter" && (
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 8, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={xKey} name={xKey} tick={{ fontSize: 11 }} />
              <YAxis dataKey={yKey} name={yKey} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={styles.tooltip} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={cleanData} fill="#3b82f6" />
            </ScatterChart>
          </ResponsiveContainer>
        )}

        {chartType === "table" && (
          <div style={styles.tableNote}>
            Data is best viewed in the table below.
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "16px 16px 8px",
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: "#334155",
    margin: "0 0 8px 0",
  },
  chartContainer: {
    width: "100%",
    minHeight: 200,
  },
  tooltip: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },
  tableNote: {
    padding: 20,
    textAlign: "center" as const,
    color: "#64748b",
    fontSize: 13,
  },
};
