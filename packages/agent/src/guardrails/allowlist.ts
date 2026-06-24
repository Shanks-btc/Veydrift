// Token allowlist guardrail — pure, no side-effects.
// Allowlist confirmed in docs/risk-policy.md §4.1 and verify-in-docs.md §16.
// BNB is gas-only and is NOT in the tradeable set.

import type { AssetSymbol, GuardrailResult } from "@veydrift/shared";

// Spot-only tradeable assets. No perps, no leverage, no order book.
export const VOLATILE_ASSETS: ReadonlySet<AssetSymbol> = new Set([
  "ETH",
  "CAKE",
  "LINK",
]);

export const STABLE_ASSETS: ReadonlySet<AssetSymbol> = new Set([
  "USDT",
  "USDC",
  "USD1",
  "FDUSD",
]);

// BNB is a gas reserve. Never a trading position.
export const GAS_ASSET: AssetSymbol = "BNB";

export const TRADEABLE_ASSETS: ReadonlySet<AssetSymbol> = new Set([
  ...VOLATILE_ASSETS,
  ...STABLE_ASSETS,
]);

// Returns true for spot-tradeable assets (volatile + stables).
// BNB, BTC, BTCB, and anything else return false.
export function isTradeable(asset: string): asset is AssetSymbol {
  return TRADEABLE_ASSETS.has(asset as AssetSymbol);
}

export function isVolatile(asset: AssetSymbol): boolean {
  return VOLATILE_ASSETS.has(asset);
}

export function isStable(asset: AssetSymbol): boolean {
  return STABLE_ASSETS.has(asset);
}

// Full guardrail check for use in the trade gate.
export function checkAllowlist(
  fromAsset: string,
  toAsset: string,
): GuardrailResult {
  if (!isTradeable(fromAsset)) {
    return {
      ok: false,
      guardName: "allowlist",
      reason: `fromAsset "${fromAsset}" is not in the tradeable allowlist`,
    };
  }
  if (!isTradeable(toAsset)) {
    return {
      ok: false,
      guardName: "allowlist",
      reason: `toAsset "${toAsset}" is not in the tradeable allowlist`,
    };
  }
  return { ok: true, guardName: "allowlist", reason: "both assets are allowlisted" };
}
