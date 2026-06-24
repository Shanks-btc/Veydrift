// Slippage guardrail — pure, no side-effects.
// Validates TWAK quote fields before any execution decision is made.
// Field names (priceImpact, minReceived, output) match the confirmed TWAK
// quote output in docs/verify-in-docs.md §6.
// Threshold from docs/risk-policy.md §4.4.

import type { GuardrailResult, PolicyConfig, TwakQuote } from "@veydrift/shared";
import { DEFAULT_POLICY } from "../config.js";

// Check the TWAK quote's priceImpact against the configured slippage limit.
// Converts priceImpact to a number first (TWAK may return it as a string).
export function checkSlippage(
  quote: TwakQuote,
  policy: PolicyConfig = DEFAULT_POLICY,
): GuardrailResult {
  const impactPct = Number(quote.priceImpact);

  if (Number.isNaN(impactPct)) {
    return {
      ok: false,
      guardName: "slippage",
      reason: `Cannot parse priceImpact from TWAK quote: "${quote.priceImpact}"`,
    };
  }

  if (impactPct > policy.maxSlippagePct) {
    return {
      ok: false,
      guardName: "slippage",
      reason: `TWAK quote priceImpact ${impactPct.toFixed(3)}% exceeds limit of ${policy.maxSlippagePct}%`,
    };
  }

  return {
    ok: true,
    guardName: "slippage",
    reason: `priceImpact ${impactPct.toFixed(3)}% is within slippage limit`,
  };
}
