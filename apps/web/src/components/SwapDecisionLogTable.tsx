import type { SwapLogRow } from "@veydrift/shared";
import { fmtUsd, fmtDateTime, shortHash, modeColor, pctColor } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

const actionColors: Record<string, string> = {
  Buy: "var(--green)",
  Sell: "var(--red)",
  Rebalance: "var(--amber)",
  Hold: "var(--text-muted)",
};

export function SwapDecisionLogTable({ data }: { data: SwapLogRow[] }) {
  return (
    <Card>
      <CardHeader title="Swap / Decision Log" subtitle="All autonomous actions" />
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}
        >
          <thead>
            <tr>
              {["Time", "Mode", "Action", "Route", "Size", "Value", "Reason", "Tx Hash"].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "0 8px 8px",
                      fontSize: "10px",
                      fontWeight: 600,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                      borderBottom: "1px solid var(--border)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    padding: "24px 8px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                    fontSize: "12px",
                  }}
                >
                  No live trades recorded yet — the scheduler will log decisions here on each cycle.
                </td>
              </tr>
            )}
            {data.map((row, i) => (
              <tr
                key={row.id}
                style={{
                  borderBottom:
                    i < data.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <td
                  style={{
                    padding: "9px 8px",
                    fontFamily: "monospace",
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtDateTime(row.timestamp)}
                </td>
                <td style={{ padding: "9px 8px" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: modeColor(row.mode),
                      background: `${modeColor(row.mode)}18`,
                      border: `1px solid ${modeColor(row.mode)}40`,
                      borderRadius: "3px",
                      padding: "1px 5px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.mode}
                  </span>
                </td>
                <td style={{ padding: "9px 8px" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: actionColors[row.action],
                    }}
                  >
                    {row.action}
                  </span>
                </td>
                <td
                  style={{
                    padding: "9px 8px",
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                    color: "var(--text-primary)",
                  }}
                >
                  {row.action === "Hold"
                    ? "—"
                    : `${row.fromAsset} → ${row.toAsset}`}
                </td>
                <td
                  style={{
                    padding: "9px 8px",
                    fontFamily: "monospace",
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.sizeIn > 0 ? row.sizeIn.toLocaleString() : "—"}
                </td>
                <td
                  style={{
                    padding: "9px 8px",
                    fontFamily: "monospace",
                    color: "var(--text-primary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.valueUsd > 0 ? fmtUsd(row.valueUsd) : "—"}
                </td>
                <td
                  style={{
                    padding: "9px 8px",
                    color: "var(--text-secondary)",
                    maxWidth: "200px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={row.reason}
                >
                  {row.reason}
                </td>
                <td style={{ padding: "9px 8px" }}>
                  {row.txHash && row.explorerUrl ? (
                    <a
                      href={row.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: "11px",
                        color: "var(--blue)",
                        fontFamily: "monospace",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {shortHash(row.txHash)} ↗
                    </a>
                  ) : (
                    <span
                      style={{ fontSize: "11px", color: "var(--text-muted)" }}
                    >
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
