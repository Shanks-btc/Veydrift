import type { SpotHolding } from "@veydrift/shared";
import { fmtUsd, fmtNum, fmtPct, pctColor } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

const roleColors: Record<string, string> = {
  Volatile: "var(--green)",
  Stable: "var(--blue)",
  Gas: "#F0B90B",
};

interface Props {
  data: SpotHolding[];
  /** Override the default empty-state message when snapshot exists but holdings are unavailable. */
  emptyMessage?: string;
}

export function SpotHoldingsTable({ data, emptyMessage }: Props) {
  return (
    <Card>
      <CardHeader title="Spot Holdings" subtitle="Allowlist assets only · BNB = gas reserve" />
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr>
              {["Asset", "Role", "Balance", "USD Value", "Alloc %", "24h"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === "Asset" || h === "Role" ? "left" : "right",
                    padding: "0 8px 8px",
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: "24px 8px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                    fontSize: "12px",
                  }}
                >
                  {emptyMessage ?? "Awaiting portfolio snapshot"}
                </td>
              </tr>
            )}
            {data.map((row, i) => (
              <tr
                key={row.asset}
                style={{
                  borderBottom: i < data.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <td style={{ padding: "10px 8px", fontWeight: 700, fontFamily: "monospace" }}>
                  {row.asset}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: roleColors[row.role],
                      background: `${roleColors[row.role]}18`,
                      border: `1px solid ${roleColors[row.role]}30`,
                      borderRadius: "4px",
                      padding: "2px 6px",
                    }}
                  >
                    {row.role}
                  </span>
                </td>
                <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace" }}>
                  {fmtNum(row.balance, 4)}
                </td>
                <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace" }}>
                  {fmtUsd(row.valueUsd)}
                </td>
                <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace" }}>
                  {row.allocationPct.toFixed(1)}%
                </td>
                <td
                  style={{
                    padding: "10px 8px",
                    textAlign: "right",
                    fontFamily: "monospace",
                    color: row.change24hPct !== null ? pctColor(row.change24hPct) : "var(--text-muted)",
                  }}
                >
                  {row.change24hPct !== null ? fmtPct(row.change24hPct, 2) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
