import { useState, useMemo } from "react";

/*
 * ResultsTable — sortable data table for query results.
 *
 * Features:
 *   - Click column headers to sort (asc → desc → none)
 *   - Alternating row backgrounds for readability
 *   - Truncates long values with tooltip on hover
 *   - Shows row count and "showing N of M" when truncated
 *   - Handles null values gracefully
 */

interface Props {
  columns: string[];
  rows: (string | null)[][];
  totalRows: number;
  maxDisplay?: number;
}

export default function ResultsTable({ columns, rows, totalRows, maxDisplay = 50 }: Props) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(colIdx);
      setSortDir("asc");
    }
  };

  const sortedRows = useMemo(() => {
    const display = rows.slice(0, maxDisplay);
    if (sortCol === null) return display;

    return [...display].sort((a, b) => {
      const aVal = a[sortCol] ?? "";
      const bVal = b[sortCol] ?? "";

      // Try numeric comparison first
      const aNum = Number(aVal);
      const bNum = Number(bVal);
      if (!isNaN(aNum) && !isNaN(bNum) && aVal !== "" && bVal !== "") {
        return sortDir === "asc" ? aNum - bNum : bNum - aNum;
      }

      // Fall back to string comparison
      const cmp = aVal.toString().localeCompare(bVal.toString());
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir, maxDisplay]);

  if (!columns.length || !rows.length) return null;

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Query results</span>
        <span style={styles.rowCount}>
          {rows.length > maxDisplay
            ? `Showing ${maxDisplay} of ${totalRows} rows`
            : `${totalRows} rows`}
        </span>
      </div>
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  style={styles.th}
                  onClick={() => handleSort(i)}
                  title="Click to sort"
                >
                  {col}
                  {sortCol === i && (
                    <span style={styles.sortArrow}>
                      {sortDir === "asc" ? " ▲" : " ▼"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr key={i} style={i % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                {row.map((val, j) => (
                  <td key={j} style={styles.td} title={val ?? ""}>
                    {val ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
    background: "#fff",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
  },
  rowCount: {
    fontSize: 12,
    color: "#94a3b8",
  },
  tableWrapper: {
    overflowX: "auto" as const,
    maxHeight: 400,
    overflowY: "auto" as const,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  },
  th: {
    padding: "8px 12px",
    background: "#f1f5f9",
    borderBottom: "2px solid #e2e8f0",
    textAlign: "left" as const,
    fontWeight: 600,
    color: "#334155",
    whiteSpace: "nowrap" as const,
    cursor: "pointer",
    userSelect: "none" as const,
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
  },
  sortArrow: {
    fontSize: 10,
    color: "#3b82f6",
  },
  rowEven: { background: "#fff" },
  rowOdd: { background: "#f8fafc" },
  td: {
    padding: "6px 12px",
    borderBottom: "1px solid #f1f5f9",
    color: "#334155",
    maxWidth: 220,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
};
