import type { PnL } from "@veydrift/shared";
import { fmtUsd, fmtPct, pctColor } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

interface Props {
  data: PnL | null;
  /** Label for the percentage-change line. Defaults to "24h". */
  changeLabel?: string;
}

export function PnLCard({ data, changeLabel = "24h" }: Props) {
  if (!data) {
    return (
      <Card>
        <CardHeader title="PnL" />
        <div
          style={{
            fontSize: "28px",
            fontWeight: 700,
            fontFamily: "monospace",
            color: "var(--text-muted)",
            marginBottom: "4px",
          }}
        >
          —
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          Awaiting first live cycle
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="PnL" />
      <div
        style={{
          fontSize: "28px",
          fontWeight: 700,
          fontFamily: "monospace",
          color: pctColor(data.totalUsd),
          marginBottom: "4px",
        }}
      >
        {fmtUsd(data.totalUsd)}
      </div>
      <div
        style={{
          fontSize: "13px",
          color: pctColor(data.change24hPct),
          fontFamily: "monospace",
          marginBottom: "16px",
        }}
      >
        {fmtPct(data.change24hPct)} {changeLabel}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
          borderTop: "1px solid var(--border)",
          paddingTop: "12px",
        }}
      >
        {[
          { label: "Realized", value: data.realizedUsd },
          { label: "Unrealized", value: data.unrealizedUsd },
        ].map(({ label, value }) => (
          <div key={label}>
            <div
              style={{
                fontSize: "10px",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "4px",
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: "15px",
                fontWeight: 600,
                fontFamily: "monospace",
                color: pctColor(value),
              }}
            >
              {fmtUsd(value)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
