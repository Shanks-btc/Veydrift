"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  XAxis,
} from "recharts";
import type { PortfolioValue, PortfolioFreshness } from "@veydrift/shared";
import { fmtUsd, fmtPct, fmtTime, pctColor } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

function FreshnessBadge({ freshness }: { freshness: PortfolioFreshness }) {
  const cfg: Record<PortfolioFreshness, { label: string; color: string }> = {
    LIVE:        { label: "LIVE",        color: "var(--green)" },
    STALE:       { label: "STALE",       color: "var(--amber)" },
    UNAVAILABLE: { label: "UNAVAILABLE", color: "var(--text-muted)" },
  };
  const { label, color } = cfg[freshness];
  return (
    <span style={{ fontSize: "10px", fontWeight: 700, color, letterSpacing: "0.06em",
      border: `1px solid ${color}40`, borderRadius: "3px", padding: "1px 5px" }}>
      {label}
    </span>
  );
}

interface Props {
  data: PortfolioValue | null;
  freshness?: PortfolioFreshness;
  isSimulation?: boolean;
}

export function PortfolioValueCard({ data, freshness, isSimulation }: Props) {
  if (!data) {
    return (
      <Card>
        <CardHeader title="Portfolio Value"
          action={freshness ? <FreshnessBadge freshness={freshness} /> : undefined} />
        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "24px 0", textAlign: "center" }}>
          Awaiting first live portfolio snapshot
        </div>
      </Card>
    );
  }

  const badge = isSimulation
    ? <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--amber)",
        border: "1px solid var(--amber)40", borderRadius: "3px", padding: "1px 5px" }}>SIMULATION</span>
    : freshness ? <FreshnessBadge freshness={freshness} /> : undefined;

  const positive = data.change24hPct >= 0;
  const lineColor = positive ? "var(--green)" : "var(--red)";

  return (
    <Card>
      <CardHeader title="Portfolio Value" action={badge} />
      <div style={{ marginBottom: "4px" }}>
        <span
          style={{
            fontSize: "28px",
            fontWeight: 700,
            fontFamily: "monospace",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmtUsd(data.currentUsd)}
        </span>
      </div>
      {isSimulation ? (
        <div style={{ fontSize: "11px", color: "var(--amber)", marginBottom: "12px" }}>
          Configured estimate — not live wallet data
        </div>
      ) : data.change24hPct !== 0 ? (
        <div
          style={{
            fontSize: "13px",
            color: pctColor(data.change24hPct),
            fontFamily: "monospace",
            marginBottom: "16px",
          }}
        >
          {fmtPct(data.change24hPct)} · {fmtUsd(data.change24hUsd)} today
        </div>
      ) : (
        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "12px" }}>
          Current wallet value — no PnL baseline yet
        </div>
      )}
      {data.series.length > 0 && (
        <div style={{ height: "80px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data.series}
              margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={lineColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="timestamp" hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  color: "var(--text-primary)",
                }}
                formatter={(v: number) => [fmtUsd(v), "Value"]}
                labelFormatter={(l: string) => fmtTime(l)}
              />
              <Area
                type="monotone"
                dataKey="valueUsd"
                stroke={lineColor}
                strokeWidth={1.5}
                fill="url(#portfolioGrad)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
