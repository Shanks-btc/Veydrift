import type { Exposure, Swap, PnL } from "@veydrift/shared";
import { fmtUsd, fmtPct, pctColor } from "../lib/format";

interface Props {
  portfolioUsd: number | null;
  portfolioSource?: string | null;
  exposureData: Exposure | null;
  latestSwap: Swap | null;
  drawdownPct: number | null;
  limitPct: number;
  killSwitchPct: number;
  pnlData: PnL | null;
  pnlChangeLabel: string;
}

interface SummaryItemProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}

function SummaryItem({ label, value, sub, subColor }: SummaryItemProps) {
  return (
    <div className="summary-item">
      <div className="summary-item-label">{label}</div>
      <div className="summary-item-value">{value}</div>
      {sub && (
        <div
          className="summary-item-sub"
          style={subColor ? { color: subColor } : undefined}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export function TradingSummaryRow({
  portfolioUsd,
  portfolioSource,
  exposureData,
  latestSwap,
  drawdownPct,
  limitPct,
  killSwitchPct,
  pnlData,
  pnlChangeLabel,
}: Props) {
  const portfolioSub =
    portfolioUsd === null
      ? "awaiting snapshot"
      : portfolioSource === "twak" || portfolioSource === "twak-cache"
      ? "live wallet balance"
      : portfolioSource === "snapshot"
      ? "runner snapshot"
      : portfolioSource === "env"
      ? "configured estimate (sim)"
      : "awaiting snapshot";

  return (
    <div className="summary-row">
      <SummaryItem
        label="Portfolio Value"
        value={portfolioUsd !== null ? fmtUsd(portfolioUsd) : "—"}
        sub={portfolioSub}
      />
      <SummaryItem
        label="PnL"
        value={
          pnlData !== null
            ? pnlData.totalUsd >= 0
              ? `+${fmtUsd(pnlData.totalUsd)}`
              : fmtUsd(pnlData.totalUsd)
            : "—"
        }
        sub={
          pnlData !== null
            ? `${fmtPct(pnlData.change24hPct)} · ${pnlChangeLabel}`
            : "awaiting first live cycle"
        }
        subColor={pnlData !== null ? pctColor(pnlData.totalUsd) : undefined}
      />
      <SummaryItem
        label="Volatile Exposure"
        value={exposureData ? `${exposureData.volatilePct.toFixed(1)}%` : "—"}
        sub={
          exposureData
            ? `${exposureData.stablePct.toFixed(1)}% stable · ${exposureData.gasPct.toFixed(1)}% gas`
            : "awaiting snapshot"
        }
      />
      <SummaryItem
        label="Latest Swap"
        value={latestSwap ? `${latestSwap.fromAsset} → ${latestSwap.toAsset}` : "—"}
        sub={latestSwap ? fmtUsd(latestSwap.valueUsd) : "no live trades yet"}
      />
      <SummaryItem
        label="Current Drawdown"
        value={drawdownPct !== null ? `${drawdownPct.toFixed(1)}%` : "—"}
        sub={`Limit ${limitPct}% · Kill-switch ${killSwitchPct}%`}
        subColor={
          drawdownPct !== null && drawdownPct < killSwitchPct
            ? "var(--red)"
            : drawdownPct !== null && drawdownPct < limitPct
            ? "var(--amber)"
            : "var(--text-muted)"
        }
      />
    </div>
  );
}