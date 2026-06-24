// Per-trade cap + daily-loss cap guardrails — pure, no side-effects.
// Thresholds from docs/risk-policy.md §4.2, §4.3.

import type { GuardrailResult, PolicyConfig } from "@veydrift/shared";
import { DEFAULT_POLICY } from "../config.js";

// ── Per-trade cap ─────────────────────────────────────────────────────────────
// Rejects any single swap whose USD value exceeds a fixed fraction of the
// current portfolio value. Prevents one oversized rotation.

export function checkPerTradeCap(
  tradeValueUsd: number,
  portfolioValueUsd: number,
  policy: PolicyConfig = DEFAULT_POLICY,
): GuardrailResult {
  if (portfolioValueUsd <= 0) {
    return {
      ok: false,
      guardName: "perTradeCap",
      reason: "Portfolio value is zero or negative — cannot compute trade size",
    };
  }
  const fraction = tradeValueUsd / portfolioValueUsd;
  if (fraction > policy.perTradeCapFraction) {
    return {
      ok: false,
      guardName: "perTradeCap",
      reason: `Trade is ${(fraction * 100).toFixed(1)}% of portfolio — exceeds cap of ${(policy.perTradeCapFraction * 100).toFixed(0)}%`,
    };
  }
  return {
    ok: true,
    guardName: "perTradeCap",
    reason: `Trade size ${(fraction * 100).toFixed(1)}% is within cap`,
  };
}

// ── Daily-loss cap ────────────────────────────────────────────────────────────
// Halts NEW risk-taking (de-risk only) after a daily loss threshold is
// exceeded. dailyLossUsd must be a positive number representing the loss
// (not a signed P&L). portfolioValueUsd is current portfolio value.

export function checkDailyLossCap(
  dailyLossUsd: number,
  portfolioValueUsd: number,
  policy: PolicyConfig = DEFAULT_POLICY,
): GuardrailResult {
  if (portfolioValueUsd <= 0) {
    return {
      ok: false,
      guardName: "dailyLossCap",
      reason: "Portfolio value is zero or negative",
    };
  }
  const lossPct = (dailyLossUsd / portfolioValueUsd) * 100;
  if (lossPct >= policy.dailyLossCapPct) {
    return {
      ok: false,
      guardName: "dailyLossCap",
      reason: `Daily loss ${lossPct.toFixed(2)}% reached cap of ${policy.dailyLossCapPct}% — de-risk only for the rest of the day`,
    };
  }
  return {
    ok: true,
    guardName: "dailyLossCap",
    reason: `Daily loss ${lossPct.toFixed(2)}% is within cap`,
  };
}
