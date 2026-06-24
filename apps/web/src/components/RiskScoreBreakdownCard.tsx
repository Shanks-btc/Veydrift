import type { RiskScore } from "@veydrift/shared";
import { modeColor } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

export function RiskScoreBreakdownCard({ data }: { data: RiskScore | null }) {
  if (!data) {
    return (
      <Card>
        <CardHeader title="Risk Score" subtitle="3 components — as computed" />
        <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "8px 0" }}>
          Awaiting first live cycle
        </div>
      </Card>
    );
  }

  const modeCol = modeColor(data.mode);

  return (
    <Card>
      <CardHeader title="Risk Score" subtitle="3 components — as computed" />

      {/* R score + mode */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <span
          style={{
            fontSize: "32px",
            fontWeight: 700,
            fontFamily: "monospace",
            color: modeCol,
          }}
        >
          {data.R.toFixed(2)}
        </span>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: modeCol,
            background: `${modeCol}18`,
            border: `1px solid ${modeCol}40`,
            borderRadius: "4px",
            padding: "2px 8px",
          }}
        >
          {data.mode.toUpperCase()} · {data.targetVolatilePct}% volatile
        </span>
      </div>

      {/* Components */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {data.components.map((c) => (
          <div key={c.label}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "4px",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                {c.label}
              </span>
              <span
                style={{
                  fontSize: "12px",
                  fontFamily: "monospace",
                  color: "var(--text-primary)",
                }}
              >
                {c.contribution.toFixed(3)}
              </span>
            </div>
            <div
              style={{
                height: "5px",
                borderRadius: "3px",
                backgroundColor: "var(--border)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, c.contribution * 400)}%`,
                  height: "100%",
                  backgroundColor: modeCol,
                  borderRadius: "3px",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: "12px",
          paddingTop: "10px",
          borderTop: "1px solid var(--border)",
          fontSize: "11px",
          color: "var(--text-muted)",
        }}
      >
        R = |1h|/3·0.4 + |24h|/10·0.4 + max(0,(F&G−60)/40)·0.2
      </div>
    </Card>
  );
}
