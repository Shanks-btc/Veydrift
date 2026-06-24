import type { PolicyConfig } from "@veydrift/shared";

// Default policy — values are taken directly from docs/risk-policy.md.
// All thresholds are tunable by passing an overridden PolicyConfig; these
// defaults must remain internally consistent: killSwitchPct < drawdownAlertPct.
export const DEFAULT_POLICY: PolicyConfig = {
  // Risk engine weights (must sum to 1.0)
  change1hWeight: 0.4,
  change24hWeight: 0.4,
  fearGreedWeight: 0.2,

  // Risk engine scales
  change1hScale: 3,       // |c1h| / 3  (saturates at ±3% move)
  change24hScale: 10,     // |c24h| / 10 (saturates at ±10% move)
  fearGreedNeutral: 60,   // greed premium above 60

  // Mode thresholds
  riskOnThreshold: 0.33,
  riskOffThreshold: 0.66,

  // Target volatile exposure (spot holdings; never 0 — never-dust invariant)
  riskOnTargetPct: 80,
  neutralTargetPct: 45,
  riskOffTargetPct: 18,   // intentionally non-zero: "mostly stables, not zero"

  // Guardrails
  perTradeCapFraction: 0.25,  // no single swap > 25% of portfolio value
  dailyLossCapPct: 5,         // halt new risk after 5% daily loss
  maxSlippagePct: 1.0,        // reject swap if TWAK priceImpact > 1%
  drawdownAlertPct: -12,      // alert threshold
  killSwitchPct: -18,         // hard backstop — rotate to stables, never dust

  // Anti-churn
  rebalanceBandPct: 5,        // only rebalance if deviation from target > 5%

  // Daily qualification scheduler
  fallbackSwapSizeUsd: 2,     // minimum drawdown-neutral fallback stable-to-stable swap

  // Post-formula overlay thresholds (drawdown + Hub enrichments)
  drawdownOverlayStartPct: -8,       // overlay kicks in below -8% from HWM
  drawdownOverlayCap: 45,            // cap at neutral target while in overlay zone
  emergencyModeThresholdPct: -14,    // emergency mode (only de-risk) below -14%

  macroEventWindowHours: 24,         // pre-emptive de-risk window before macro event
  macroEventTargetCap: 30,           // volatile % cap inside the event window

  rsiCautionThreshold: 75,           // RSI above 75 triggers TA-caution overlay
  rsiCautionTargetCap: 45,           // volatile % cap when RSI is in caution zone

  btcDominanceRiskOffThreshold: 55,  // BTC dominance above 55% signals risk-off regime
  btcDominanceTargetCap: 45,         // volatile % cap in risk-off regime
};
