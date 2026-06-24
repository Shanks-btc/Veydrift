// Max-drawdown kill-switch guardrail — pure, no side-effects.
// The hard backstop from docs/risk-policy.md §4.5.
//
// On breach: action is ALWAYS "flatten-to-stables" (never "drain-to-dust").
// Never-dust invariant: the kill-switch rotates to in-scope stable assets,
// keeping the portfolio fully deployed in stables, not to zero.

import type { KillSwitchResult, PolicyConfig } from "@veydrift/shared";
import { DEFAULT_POLICY } from "../config.js";

// drawdownPct is a NEGATIVE number, e.g. -15.0 means 15% below HWM.
// killSwitchPct is also negative (from policy), e.g. -18.
// The switch triggers when drawdownPct <= killSwitchPct (more negative = worse).
export function checkKillSwitch(
  drawdownPct: number,
  policy: PolicyConfig = DEFAULT_POLICY,
): KillSwitchResult {
  if (drawdownPct <= policy.killSwitchPct) {
    return {
      triggered: true,
      action: "flatten-to-stables", // NEVER "drain-to-dust"
      drawdownPct,
      reason: `Drawdown ${drawdownPct.toFixed(2)}% reached kill-switch threshold ${policy.killSwitchPct}% — flattening volatile holdings to stables`,
    };
  }
  return {
    triggered: false,
    action: "hold",
    drawdownPct,
    reason: `Drawdown ${drawdownPct.toFixed(2)}% is above kill-switch threshold ${policy.killSwitchPct}%`,
  };
}

// Compute current drawdown from portfolio high-water mark.
// Returns a negative number (e.g. -4.2) or 0 if at/above HWM.
export function computeDrawdown(
  currentValueUsd: number,
  highWaterMarkUsd: number,
): number {
  if (highWaterMarkUsd <= 0) return 0;
  return Math.min(0, ((currentValueUsd - highWaterMarkUsd) / highWaterMarkUsd) * 100);
}
