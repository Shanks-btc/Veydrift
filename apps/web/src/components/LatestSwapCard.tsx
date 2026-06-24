import type { Swap } from "@veydrift/shared";
import { fmtUsd, fmtNum, fmtRelative, shortHash } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

export function LatestSwapCard({ data }: { data: Swap | null }) {
  if (!data) {
    return (
      <Card>
        <CardHeader title="Latest Swap" />
        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "24px 0", textAlign: "center" }}>
          No swaps recorded yet — live cycles will appear here.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Latest Swap" />
      <div
        style={{
          fontSize: "22px",
          fontWeight: 700,
          fontFamily: "monospace",
          marginBottom: "4px",
        }}
      >
        {data.fromAsset} → {data.toAsset}
      </div>
      <div
        style={{
          fontSize: "13px",
          color: "var(--text-muted)",
          marginBottom: "14px",
        }}
      >
        {fmtRelative(data.timestamp)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
        {[
          { label: "Amount In",  value: `${fmtNum(data.amountIn, 6)} ${data.fromAsset}` },
          { label: "Amount Out", value: data.amountOut > 0 ? `${fmtNum(data.amountOut, 6)} ${data.toAsset}` : "—" },
          { label: "Value",      value: data.valueUsd > 0 ? fmtUsd(data.valueUsd) : "—" },
          { label: "Slippage",   value: data.slippagePct > 0 ? `${data.slippagePct.toFixed(2)}%` : "—" },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "2px" }}>{label}</div>
            <div style={{ fontSize: "13px", fontWeight: 600, fontFamily: "monospace", color: "var(--text-primary)" }}>{value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          fontSize: "11px",
          color: "var(--text-secondary)",
          fontStyle: "italic",
          marginBottom: "10px",
          borderLeft: "2px solid var(--border)",
          paddingLeft: "8px",
        }}
      >
        {data.reason}
      </div>

      <a
        href={data.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: "12px",
          color: "var(--blue)",
          fontFamily: "monospace",
          textDecoration: "none",
        }}
      >
        {shortHash(data.txHash)} ↗
      </a>
    </Card>
  );
}
