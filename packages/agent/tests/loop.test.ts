import { describe, it, expect } from "vitest";
import { runCycle } from "../src/loop/cycle.js";
import { evaluateTrade } from "../src/loop/gate.js";
import type { MarketSnapshot, PortfolioState, TwakQuote } from "@veydrift/shared";

// ── Helpers ───────────────────────────────────────────────────────────────────

function snap(
  change1h: number,
  change24h: number,
  fearGreed: number,
  price = 3000,
): MarketSnapshot {
  return {
    symbol: "ETH",
    price,
    change1h,
    change24h,
    fearGreed,
    fetchedAt: new Date().toISOString(),
  };
}

function port(
  totalValueUsd: number,
  volatileValueUsd: number,
  overrides: Partial<PortfolioState> = {},
): PortfolioState {
  return {
    totalValueUsd,
    volatileValueUsd,
    stableValueUsd: totalValueUsd - volatileValueUsd,
    highWaterMarkUsd: totalValueUsd,
    dailyLossUsd: 0,
    ...overrides,
  };
}

function stubRunner(quote: Partial<TwakQuote> = {}) {
  const full = {
    input: 100,
    output: 0.033,
    minReceived: 0.0327,
    provider: "TestProvider",
    priceImpact: 0,
    ...quote,
  };
  return () => JSON.stringify(full);
}

// ── Within-band: hold ─────────────────────────────────────────────────────────

describe("within-band cycle → hold", () => {
  it("returns no proposal when current exposure is within the rebalance band", () => {
    // R ≈ 0.116 (1h=0.24, 24h=2.10, fg=23) → Risk-on → target 80%
    // Current = 80% volatile → |80-80| = 0 < 5% band → hold
    const result = runCycle({
      snapshot: snap(0.24, 2.1, 23),
      portfolio: port(10_000, 8_000), // 80% volatile
    });

    expect(result.proposal).toBeNull();
    expect(result.executionPlan).toBeNull();
    expect(result.wouldBeCommand).toBeNull();
    expect(result.reason).toMatch(/[Ww]ithin band/);
  });

  it("holds when current exposure is within ±5% of target", () => {
    // Risk-on → target 80%; 83% is within 5% band (|83-80| = 3 < 5)
    const result = runCycle({
      snapshot: snap(0.24, 2.1, 23),
      portfolio: port(10_000, 8_300), // 83% volatile
    });

    expect(result.proposal).toBeNull();
    expect(result.mode).toBe("Risk-on");
  });
});

// ── Risk-on: buy volatile ─────────────────────────────────────────────────────

describe("risk-on cycle → buy volatile", () => {
  it("produces a buy-ETH proposal when below 80% target", () => {
    // R ≈ 0.116 → Risk-on, target 80%. Current = 50% → rebalance needed.
    const result = runCycle({
      snapshot: snap(0.24, 2.1, 23),
      portfolio: port(10_000, 5_000), // 50% volatile
      runner: stubRunner(),
    });

    expect(result.mode).toBe("Risk-on");
    expect(result.riskScore.targetVolatilePct).toBe(80);
    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.fromAsset).toBe("USDT");
    expect(result.proposal?.toAsset).toBe("ETH");
    expect(result.executionPlan).not.toBeNull();
    expect(result.wouldBeCommand).toMatch(/swap/);
  });

  it("trade size is clamped at the 25% per-trade cap", () => {
    // Delta = 30% of 10_000 = 3_000 USD > 2_500 cap → clamped to 2_500
    const result = runCycle({
      snapshot: snap(0.24, 2.1, 23),
      portfolio: port(10_000, 5_000), // 50% → target 80%
      runner: stubRunner(),
    });
    expect(result.proposal?.estimatedValueUsd).toBeCloseTo(2_500, 1);
  });
});

// ── Risk-off: sell volatile ───────────────────────────────────────────────────

describe("risk-off cycle → sell volatile", () => {
  it("produces a sell-ETH proposal and targets 18% (never 0%)", () => {
    // High risk: c1h=5%, c24h=15%, fg=90 → R=0.95 → Risk-off, target 18%
    // Current = 80% volatile (well above target)
    const result = runCycle({
      snapshot: snap(5, 15, 90),
      portfolio: port(10_000, 8_000), // 80% volatile
      runner: stubRunner(),
    });

    expect(result.mode).toBe("Risk-off");
    expect(result.riskScore.targetVolatilePct).toBe(18);
    expect(result.riskScore.targetVolatilePct).toBeGreaterThan(0); // never-dust
    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.fromAsset).toBe("ETH");
    expect(result.proposal?.toAsset).toBe("USDT");
  });
});

// ── Kill-switch: flatten to stables ──────────────────────────────────────────

describe("kill-switch cycle", () => {
  it("flattens to stables and suppresses normal rotation when at -18% drawdown", () => {
    // Snapshot would normally be risk-on (low R), which would buy ETH.
    // Kill-switch overrides this: ETH → USDT regardless of mode.
    const hwm = 10_000;
    const totalValueUsd = 10_000 * (1 - 0.18); // exactly -18%
    const portfolio = port(totalValueUsd, totalValueUsd * 0.5, {
      highWaterMarkUsd: hwm,
    });

    const result = runCycle({
      snapshot: snap(0.24, 2.1, 23), // low-risk snapshot (would normally buy ETH)
      portfolio,
      runner: stubRunner(),
    });

    expect(result.killSwitchResult.triggered).toBe(true);
    expect(result.killSwitchResult.action).toBe("flatten-to-stables");
    expect(result.proposal?.fromAsset).toBe("ETH");
    expect(result.proposal?.toAsset).toBe("USDT");
    expect(result.reason).toMatch(/[Kk]ill.switch/);
    expect(result.executionPlan).not.toBeNull();
  });

  it("does not trigger kill-switch at -17% drawdown", () => {
    const hwm = 10_000;
    const totalValueUsd = 10_000 * (1 - 0.17);
    const portfolio = port(totalValueUsd, totalValueUsd * 0.5, {
      highWaterMarkUsd: hwm,
    });

    const result = runCycle({
      snapshot: snap(0.24, 2.1, 23),
      portfolio,
      runner: stubRunner(),
    });

    expect(result.killSwitchResult.triggered).toBe(false);
  });
});

// ── Gate blocks on high slippage ──────────────────────────────────────────────

describe("gate blocks on slippage", () => {
  it("blocks trade when quote priceImpact exceeds 1%", () => {
    // Snapshot: risk-on → would buy ETH, but slippage guard rejects the quote
    const result = runCycle({
      snapshot: snap(0.24, 2.1, 23),
      portfolio: port(10_000, 5_000), // 50% volatile → rebalance to 80%
      runner: stubRunner({ priceImpact: 5.0 }), // 5% > 1% limit
    });

    expect(result.proposal).not.toBeNull(); // proposal was built
    expect(result.executionPlan).toBeNull(); // gate blocked it
    expect(result.wouldBeCommand).toBeNull();
    expect(result.reason).toMatch(/[Gg]uardrail/);

    const slippageResult = result.guardrailResults.find(
      (g) => g.guardName === "slippage",
    );
    expect(slippageResult?.ok).toBe(false);
  });
});

// ── Never-dust invariant ──────────────────────────────────────────────────────

describe("never-dust invariant", () => {
  it("risk-off never targets 0% volatile", () => {
    const result = runCycle({
      snapshot: snap(5, 15, 90), // maximum risk
      portfolio: port(10_000, 8_000),
      runner: stubRunner(),
    });
    expect(result.riskScore.targetVolatilePct).toBeGreaterThan(0);
    expect(result.riskScore.targetVolatilePct).toBe(18);
  });
});

// ── Off-list assets never appear ─────────────────────────────────────────────

describe("off-list assets", () => {
  it("proposal always uses allowlisted assets (never BNB, BTC, or perps)", () => {
    const ALLOWED = ["ETH", "CAKE", "LINK", "USDT", "USDC", "USD1", "FDUSD"];
    const result = runCycle({
      snapshot: snap(0.24, 2.1, 23),
      portfolio: port(10_000, 3_000), // 30% volatile → rebalance to 80%
      runner: stubRunner(),
    });

    if (result.proposal) {
      expect(ALLOWED).toContain(result.proposal.fromAsset);
      expect(ALLOWED).toContain(result.proposal.toAsset);
      expect(result.proposal.fromAsset).not.toBe("BNB");
      expect(result.proposal.toAsset).not.toBe("BNB");
    }
  });
});

// ── evaluateTrade gate: direct tests ─────────────────────────────────────────

describe("evaluateTrade gate", () => {
  const goodProposal = {
    fromAsset: "ETH" as const,
    toAsset: "USDT" as const,
    amountIn: 0.5,
    estimatedValueUsd: 1500,
    reason: "test",
    mode: "Neutral" as const,
    R: 0.5,
  };
  const goodPortfolio = port(10_000, 5_000);
  const goodQuote: TwakQuote = {
    input: 0.5,
    output: 1500,
    minReceived: 1485,
    provider: "Test",
    priceImpact: 0,
  };

  it("approves a valid trade with clean quote", () => {
    const result = evaluateTrade({
      proposal: goodProposal,
      portfolio: goodPortfolio,
      quote: goodQuote,
    });
    expect(result.approved).toBe(true);
    expect(result.firstFailure).toBeNull();
  });

  it("blocks on off-list asset (BNB)", () => {
    const result = evaluateTrade({
      proposal: { ...goodProposal, fromAsset: "BNB" as never },
      portfolio: goodPortfolio,
      quote: goodQuote,
    });
    expect(result.approved).toBe(false);
    expect(result.firstFailure?.guardName).toBe("allowlist");
  });

  it("blocks on kill-switch breach", () => {
    const triggeredPort = port(8_200, 4_100, { highWaterMarkUsd: 10_000 }); // -18% drawdown
    const result = evaluateTrade({
      proposal: goodProposal,
      portfolio: triggeredPort,
      quote: goodQuote,
    });
    expect(result.approved).toBe(false);
    expect(result.firstFailure?.guardName).toBe("killSwitch");
  });

  it("skips slippage check when quote is null", () => {
    const result = evaluateTrade({
      proposal: goodProposal,
      portfolio: goodPortfolio,
      quote: null,
    });
    expect(result.approved).toBe(true);
    expect(result.guardrailResults.some((g) => g.guardName === "slippage")).toBe(false);
  });
});
