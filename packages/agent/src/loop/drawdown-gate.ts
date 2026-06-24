// §4 — Asymmetric projected-drawdown gate (additive; new file; loop/gate.ts is untouched).
//
// Called by the scheduler BEFORE executing any trade proposal.
// Asymmetric rule:
//   • Risk-reducing (volatile → stable): always passes — de-risking improves resilience.
//   • Stable-to-stable / same direction: passes (not risk-increasing).
//   • Risk-increasing (stable → volatile): checked against overlay zone and emergency mode.
//     - Emergency zone (drawdown ≤ emergencyModeThresholdPct): blocked unconditionally.
//     - Overlay zone (drawdown ≤ drawdownOverlayStartPct): blocked if projected
//       volatile exposure would exceed drawdownOverlayCap.
//     - Outside both zones: passes.

import type { DrawdownGateResult, PolicyConfig } from "@veydrift/shared";
import { DEFAULT_POLICY } from "../config.js";
import { isTradeable, isVolatile, isStable } from "../guardrails/index.js";

export interface DrawdownGateInput {
  fromAsset: string;
  toAsset: string;
  tradeValueUsd: number;
  portfolioValueUsd: number;
  currentVolatilePct: number;
  currentDrawdownPct: number;  // negative number, e.g. -10.0
  policy?: PolicyConfig;
}

export function checkProjectedDrawdown(input: DrawdownGateInput): DrawdownGateResult {
  const policy = input.policy ?? DEFAULT_POLICY;

  // Use inline type guards so TypeScript narrows the asset type in the &&-chain
  const riskReducing =
    isTradeable(input.fromAsset) && isTradeable(input.toAsset) &&
    isVolatile(input.fromAsset) && isStable(input.toAsset);

  const riskIncreasing =
    isTradeable(input.fromAsset) && isTradeable(input.toAsset) &&
    isStable(input.fromAsset) && isVolatile(input.toAsset);

  // Risk-reducing (volatile → stable) always passes; de-risking is always welcome
  if (riskReducing || !riskIncreasing) {
    return {
      ok: true,
      guardName: "projected-drawdown",
      reason: riskReducing
        ? "risk-reducing rotation (volatile → stable): drawdown-resistant, always passes"
        : "trade is not risk-increasing (stable-to-stable or unrecognised pair): passes",
      isRiskReducing: riskReducing,
    };
  }

  // Risk-increasing trade: compute projected volatile exposure after the swap
  const currentVolatileUsd = (input.currentVolatilePct / 100) * input.portfolioValueUsd;
  const projectedVolatileUsd = currentVolatileUsd + input.tradeValueUsd;
  const projectedVolatilePct =
    input.portfolioValueUsd > 0
      ? (projectedVolatileUsd / input.portfolioValueUsd) * 100
      : 0;

  // Emergency mode: no new volatile exposure permitted
  if (input.currentDrawdownPct <= policy.emergencyModeThresholdPct) {
    return {
      ok: false,
      guardName: "projected-drawdown",
      reason:
        `emergency mode (drawdown ${input.currentDrawdownPct.toFixed(2)}% ≤ ` +
        `${policy.emergencyModeThresholdPct}%): no new volatile exposure permitted`,
      projectedVolatilePct,
      isRiskReducing: false,
    };
  }

  // Drawdown overlay zone: projected exposure must stay within the overlay cap
  if (input.currentDrawdownPct <= policy.drawdownOverlayStartPct) {
    if (projectedVolatilePct > policy.drawdownOverlayCap) {
      return {
        ok: false,
        guardName: "projected-drawdown",
        reason:
          `projected volatile ${projectedVolatilePct.toFixed(1)}% > ` +
          `overlay cap ${policy.drawdownOverlayCap}% ` +
          `(drawdown ${input.currentDrawdownPct.toFixed(2)}%)`,
        projectedVolatilePct,
        isRiskReducing: false,
      };
    }
  }

  return {
    ok: true,
    guardName: "projected-drawdown",
    reason: `projected volatile ${projectedVolatilePct.toFixed(1)}% within safe bounds`,
    projectedVolatilePct,
    isRiskReducing: false,
  };
}
