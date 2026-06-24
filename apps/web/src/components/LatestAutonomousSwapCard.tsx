import type { Swap } from "@veydrift/shared";
import { fmtUsd, fmtNum, fmtDateTime, shortHash } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

export function LatestAutonomousSwapCard({ data }: { data: Swap | null }) {
  if (!data) {
    return (
      <Card>
        <CardHeader title="Latest Autonomous Swap" />
        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "24px 0", textAlign: "center" }}>
          No autonomous swaps recorded yet — the daily qualification scheduler will log here.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Latest Autonomous Swap" />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "14px",
        }}
      >
        <span style={{ fontSize: "20px", fontWeight: 700, fontFamily: "monospace" }}>
          {data.fromAsset}
        </span>
        <span style={{ fontSize: "16px", color: "var(--text-muted)" }}>→</span>
        <span style={{ fontSize: "20px", fontWeight: 700, fontFamily: "monospace" }}>
          {data.toAsset}
        </span>
        <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "auto" }}>
          {fmtDateTime(data.timestamp)}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "10px",
          marginBottom: "12px",
        }}
      >
        {[
          { label: "In",      value: `${fmtNum(data.amountIn, 6)} ${data.fromAsset}` },
          { label: "Out",     value: data.amountOut > 0 ? `${fmtNum(data.amountOut, 6)} ${data.toAsset}` : "—" },
          { label: "Value",   value: data.valueUsd > 0 ? fmtUsd(data.valueUsd) : "—" },
          { label: "Impact",  value: data.priceImpactPct > 0 ? `${data.priceImpactPct.toFixed(2)}%` : "—" },
          { label: "Slippage",value: data.slippagePct > 0 ? `${data.slippagePct.toFixed(2)}%` : "—" },
        ].map(({ label, value }) => (
          <div key={label}>
            <div
              style={{
                fontSize: "10px",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "2px",
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "monospace",
                color: "var(--text-primary)",
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          fontSize: "12px",
          color: "var(--text-secondary)",
          fontStyle: "italic",
          marginBottom: "10px",
          borderLeft: "2px solid var(--border)",
          paddingLeft: "8px",
          lineHeight: "1.5",
        }}
      >
        {data.reason}
      </div>

      <a
        href={data.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "12px",
          color: "var(--blue)",
          fontFamily: "monospace",
          textDecoration: "none",
        }}
      >
        <span>Tx</span>
        <span>{shortHash(data.txHash)}</span>
        <span style={{ fontSize: "11px" }}>↗ BSCScan</span>
      </a>
    </Card>
  );
}
