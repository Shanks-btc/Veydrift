// Post-formula overlay stack — additive clamps on the engine's mode output.
//
// Rules:
//   • Every overlay can only LOWER the volatile target, never raise it.
//   • The 3-mode formula (risk/engine.ts) and its mode→target mapping are untouched.
//   • Hub enrichment overlays are best-effort: skip silently when input is absent.
//   • Drawdown / emergency overlays have priority; Hub overlays apply afterwards.

import type {
  PolicyConfig,
  HubSignals,
  OverlayInput,
  AppliedOverlay,
  OverlayResult,
} from "@veydrift/shared";
import { DEFAULT_POLICY } from "../config.js";

// ── Emergency mode check ──────────────────────────────────────────────────────

// Returns true when the portfolio drawdown is near the kill-switch threshold.
// In emergency mode the only permitted actions are a risk-reducing rotation or
// a minimum-risk qualifying attempt — no new volatile exposure.
export function isEmergencyMode(
  drawdownPct: number,
  policy: PolicyConfig = DEFAULT_POLICY,
): boolean {
  return drawdownPct <= policy.emergencyModeThresholdPct;
}

// ── Individual overlay functions (exported for isolated unit testing) ─────────

// Drawdown overlay: caps the volatile target at drawdownOverlayCap when the
// portfolio is bleeding below the overlay start threshold.
export function applyDrawdownOverlay(
  target: number,
  drawdownPct: number,
  policy: PolicyConfig = DEFAULT_POLICY,
): number {
  if (drawdownPct <= policy.drawdownOverlayStartPct) {
    return Math.min(target, policy.drawdownOverlayCap);
  }
  return target;
}

// Macro-event de-risk overlay (Hub: get_upcoming_macro_events).
// Skipped silently when hoursToNextMacroEvent is undefined.
export function applyMacroEventOverlay(
  target: number,
  hoursToNextMacroEvent: number | undefined,
  policy: PolicyConfig = DEFAULT_POLICY,
): number {
  if (hoursToNextMacroEvent !== undefined && hoursToNextMacroEvent < policy.macroEventWindowHours) {
    return Math.min(target, policy.macroEventTargetCap);
  }
  return target;
}

// TA-caution overlay (Hub: get_crypto_technical_analysis).
// Skipped silently when rsi is undefined.
export function applyTACautionOverlay(
  target: number,
  rsi: number | undefined,
  policy: PolicyConfig = DEFAULT_POLICY,
): number {
  if (rsi !== undefined && rsi > policy.rsiCautionThreshold) {
    return Math.min(target, policy.rsiCautionTargetCap);
  }
  return target;
}

// Regime-bias overlay (Hub: get_global_metrics_latest).
// Skipped silently when btcDominancePct is undefined.
export function applyRegimeBiasOverlay(
  target: number,
  btcDominancePct: number | undefined,
  policy: PolicyConfig = DEFAULT_POLICY,
): number {
  if (btcDominancePct !== undefined && btcDominancePct > policy.btcDominanceRiskOffThreshold) {
    return Math.min(target, policy.btcDominanceTargetCap);
  }
  return target;
}

// ── Full overlay stack ────────────────────────────────────────────────────────

// Apply all overlays in order to the engine's mode target.
//
// Order:
//   1. Emergency (highest priority) or drawdown overlay — mutually exclusive
//   2. Hub enrichment overlays — macro-event → TA-caution → regime-bias
//      (applied independently; each can only reduce the running target further)
//
// An AppliedOverlay entry is recorded only when an overlay actually lowers the
// target. emergencyMode is set to true whenever drawdown ≤ emergencyModeThresholdPct,
// even if the target was already at the minimum (no entry needed).
export function applyAllOverlays(
  input: OverlayInput,
  policy: PolicyConfig = DEFAULT_POLICY,
): OverlayResult {
  const hub: HubSignals = input.hub ?? {};
  let target = input.modeTarget;
  const overlaysApplied: AppliedOverlay[] = [];
  let emergencyMode = false;

  // ── Drawdown / emergency overlays (priority over Hub enrichments) ─────────
  if (input.drawdownPct <= policy.emergencyModeThresholdPct) {
    emergencyMode = true;
    const adjusted = Math.min(target, policy.riskOffTargetPct);
    if (adjusted < target) {
      overlaysApplied.push({
        name: "emergency",
        originalTarget: target,
        adjustedTarget: adjusted,
        reason:
          `drawdown ${input.drawdownPct.toFixed(2)}% ≤ emergency threshold ${policy.emergencyModeThresholdPct}%`,
      });
      target = adjusted;
    }
  } else if (input.drawdownPct <= policy.drawdownOverlayStartPct) {
    const adjusted = Math.min(target, policy.drawdownOverlayCap);
    if (adjusted < target) {
      overlaysApplied.push({
        name: "drawdown",
        originalTarget: target,
        adjustedTarget: adjusted,
        reason:
          `drawdown ${input.drawdownPct.toFixed(2)}% ≤ overlay start ${policy.drawdownOverlayStartPct}%`,
      });
      target = adjusted;
    }
  }

  // ── Hub enrichment overlays (best-effort, applied independently) ──────────

  // Macro-event de-risk overlay
  if (hub.hoursToNextMacroEvent !== undefined) {
    const adjusted = applyMacroEventOverlay(target, hub.hoursToNextMacroEvent, policy);
    if (adjusted < target) {
      overlaysApplied.push({
        name: "macro-event",
        originalTarget: target,
        adjustedTarget: adjusted,
        reason:
          `macro event in ${hub.hoursToNextMacroEvent.toFixed(1)}h < window ${policy.macroEventWindowHours}h`,
      });
      target = adjusted;
    }
  }

  // TA-caution overlay
  if (hub.rsi !== undefined) {
    const adjusted = applyTACautionOverlay(target, hub.rsi, policy);
    if (adjusted < target) {
      overlaysApplied.push({
        name: "ta-caution",
        originalTarget: target,
        adjustedTarget: adjusted,
        reason: `RSI ${hub.rsi.toFixed(1)} > caution threshold ${policy.rsiCautionThreshold}`,
      });
      target = adjusted;
    }
  }

  // Regime-bias overlay
  if (hub.btcDominancePct !== undefined) {
    const adjusted = applyRegimeBiasOverlay(target, hub.btcDominancePct, policy);
    if (adjusted < target) {
      overlaysApplied.push({
        name: "regime-bias",
        originalTarget: target,
        adjustedTarget: adjusted,
        reason:
          `BTC dominance ${hub.btcDominancePct.toFixed(1)}% > threshold ${policy.btcDominanceRiskOffThreshold}%`,
      });
      target = adjusted;
    }
  }

  return { finalTarget: target, overlaysApplied, emergencyMode };
}
