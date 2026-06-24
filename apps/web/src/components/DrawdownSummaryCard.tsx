import type { DrawdownState } from "@veydrift/shared";
import { fmtUsd } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

export function DrawdownSummaryCard({ data }: { data: DrawdownState | null }) {
  if (!data) {
    return (
      <Card>
        <CardHeader title="Current Drawdown" />
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
        <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          Awaiting portfolio snapshot
        </div>
      </Card>
    );
  }

  const pct = data.currentPct;
  const atKillSwitch = pct <= data.killSwitchPct;
  const atLimit = pct <= data.limitPct;
  const color = atKillSwitch
    ? "var(--red)"
    : atLimit
    ? "var(--amber)"
    : "var(--green)";

  const progress = Math.min(
    100,
    (Math.abs(pct) / Math.abs(data.killSwitchPct)) * 100
  );

  return (
    <Card>
      <CardHeader title="Current Drawdown" />
      <div
        style={{
          fontSize: "28px",
          fontWeight: 700,
          fontFamily: "monospace",
          color,
          marginBottom: "4px",
        }}
      >
        {pct.toFixed(1)}%
      </div>
      <div
        style={{
          fontSize: "12px",
          color: "var(--text-muted)",
          marginBottom: "14px",
          fontFamily: "monospace",
        }}
      >
        Drawdown from high-water mark · HWM {data.highWaterMarkUsd > 0 ? fmtUsd(data.highWaterMarkUsd) : "—"}
      </div>

      {/* Progress bar toward kill-switch */}
      <div
        style={{
          height: "6px",
          borderRadius: "3px",
          backgroundColor: "var(--border)",
          marginBottom: "10px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            backgroundColor: color,
            borderRadius: "3px",
            transition: "width 0.3s",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace" }}>
          Limit {data.limitPct}%
        </span>
        <span style={{ fontSize: "11px", color: "var(--red)", fontFamily: "monospace" }}>
          Kill-switch {data.killSwitchPct}%
        </span>
      </div>
    </Card>
  );
}
