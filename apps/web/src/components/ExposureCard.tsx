import type { Exposure, PortfolioFreshness } from "@veydrift/shared";
import { Card, CardHeader } from "./ui/Card";

interface Props {
  data: Exposure | null;
  freshness?: PortfolioFreshness;
  isSimulation?: boolean;
}

export function ExposureCard({ data, freshness, isSimulation }: Props) {
  const badge = isSimulation
    ? <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--amber)",
        border: "1px solid var(--amber)40", borderRadius: "3px", padding: "1px 5px" }}>SIM</span>
    : freshness
    ? (() => {
        const cfg: Record<PortfolioFreshness, { label: string; color: string }> = {
          LIVE:        { label: "LIVE",  color: "var(--green)" },
          STALE:       { label: "STALE", color: "var(--amber)" },
          UNAVAILABLE: { label: "—",     color: "var(--text-muted)" },
        };
        const { label, color } = cfg[freshness];
        return (
          <span style={{ fontSize: "10px", fontWeight: 700, color, letterSpacing: "0.06em",
            border: `1px solid ${color}40`, borderRadius: "3px", padding: "1px 5px" }}>
            {label}
          </span>
        );
      })()
    : undefined;

  if (!data) {
    return (
      <Card>
        <CardHeader title="Volatile Exposure" action={badge} />
        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "24px 0", textAlign: "center" }}>
          Awaiting first live portfolio snapshot
        </div>
      </Card>
    );
  }

  const bars = [
    { label: "Volatile", pct: Math.round(data.volatilePct), color: "var(--green)" },
    { label: "Stable",   pct: Math.round(data.stablePct),   color: "var(--blue)" },
    { label: "Gas (BNB)",pct: Math.round(data.gasPct),      color: "#F0B90B" },
  ];

  return (
    <Card>
      <CardHeader title="Volatile Exposure" action={badge} />
      <div
        style={{
          fontSize: "28px",
          fontWeight: 700,
          fontFamily: "monospace",
          marginBottom: "16px",
        }}
      >
        {Math.round(data.volatilePct)}%
      </div>

      <div
        style={{
          height: "8px",
          borderRadius: "4px",
          overflow: "hidden",
          display: "flex",
          marginBottom: "12px",
        }}
      >
        {bars.map(({ label, pct, color }) => (
          <div
            key={label}
            style={{ width: `${pct}%`, backgroundColor: color }}
            title={`${label}: ${pct}%`}
          />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {bars.map(({ label, pct, color }) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "2px",
                  backgroundColor: color,
                  display: "inline-block",
                }}
              />
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                {label}
              </span>
            </div>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "monospace",
                color: "var(--text-primary)",
              }}
            >
              {pct}%
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
