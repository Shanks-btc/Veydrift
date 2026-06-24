import type { MarketSignals } from "@veydrift/shared";
import { fmtUsd, fmtPct, pctColor } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

function fg(value: number): string {
  if (value <= 25) return "var(--red)";
  if (value <= 45) return "var(--amber)";
  if (value <= 55) return "var(--text-secondary)";
  if (value <= 75) return "var(--green)";
  return "var(--green)";
}

export function MarketSignalsCard({ data }: { data: MarketSignals | null }) {
  if (!data) {
    return (
      <Card>
        <CardHeader title="Market Signals" subtitle="ETH · Live" />
        <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "8px 0" }}>
          Awaiting first live cycle
        </div>
      </Card>
    );
  }

  const trendColor =
    data.trend === "Bullish"
      ? "var(--green)"
      : data.trend === "Bearish"
      ? "var(--red)"
      : "var(--amber)";

  return (
    <Card>
      <CardHeader
        title="Market Signals"
        subtitle={`${data.assetSymbol} · Live`}
      />

      {/* Price */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "14px",
        }}
      >
        <span
          style={{
            fontSize: "22px",
            fontWeight: 700,
            fontFamily: "monospace",
          }}
        >
          {data.assetPrice > 0 ? fmtUsd(data.assetPrice) : "—"}
        </span>
        <span
          style={{
            fontSize: "13px",
            fontFamily: "monospace",
            color: trendColor,
            fontWeight: 600,
          }}
        >
          {data.trend}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {[
          { label: "Fear & Greed", value: `${data.fearGreed} · ${data.fearGreedLabel}`, color: fg(data.fearGreed) },
          { label: "1h Change", value: fmtPct(data.change1hPct), color: pctColor(data.change1hPct) },
          { label: "24h Change", value: fmtPct(data.change24hPct), color: pctColor(data.change24hPct) },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{label}</span>
            <span style={{ fontSize: "13px", fontWeight: 600, fontFamily: "monospace", color }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
