import { describe, it, expect } from "vitest";
import { computeRiskScore, pickMode, shouldRebalance } from "../src/risk/engine.js";
import { DEFAULT_POLICY } from "../src/config.js";
import type { MarketSnapshot } from "@veydrift/shared";

// ── Helper ────────────────────────────────────────────────────────────────────

function snapshot(change1h: number, change24h: number, fearGreed: number): MarketSnapshot {
  return {
    symbol: "ETH",
    price: 1719.3,
    change1h,
    change24h,
    fearGreed,
    fetchedAt: new Date().toISOString(),
  };
}

// ── Verified worked example from docs/risk-policy.md §2 ─────────────────────

describe("computeRiskScore — verified sample from risk-policy.md", () => {
  it("produces R ≈ 0.12 for the observed sample (1h=0.24, 24h=2.10, F&G=23)", () => {
    // Expected from docs: R ≈ 0.03 + 0.08 + 0 = 0.12
    // Exact:
    //   c1h  = min(1, |0.24|/3)  * 0.4 = 0.08 * 0.4 = 0.032
    //   c24h = min(1, |2.10|/10) * 0.4 = 0.21 * 0.4 = 0.084
    //   fg   = max(0, (23-60)/40) * 0.2 = 0
    //   R    = 0.032 + 0.084 + 0 = 0.116
    const result = computeRiskScore(snapshot(0.24, 2.10, 23));
    expect(result.R).toBeCloseTo(0.116, 5);
    expect(result.mode).toBe("Risk-on");
    expect(result.targetVolatilePct).toBe(80);
  });

  it("decomposes into the correct three components", () => {
    const result = computeRiskScore(snapshot(0.24, 2.10, 23));
    const [c1h, c24h, fg] = result.components;

    expect(c1h.label).toBe("1h Change");
    expect(c1h.contribution).toBeCloseTo(0.032, 5);

    expect(c24h.label).toBe("24h Change");
    expect(c24h.contribution).toBeCloseTo(0.084, 5);

    expect(fg.label).toBe("Fear & Greed");
    expect(fg.contribution).toBe(0); // plain fear (23) does NOT raise R
  });
});

// ── Plain fear does not raise R (intentional policy) ─────────────────────────

describe("computeRiskScore — plain fear adds nothing", () => {
  it("returns 0 for the fearGreed component when F&G = 0 (max fear)", () => {
    const result = computeRiskScore(snapshot(0, 0, 0));
    expect(result.components[2].contribution).toBe(0);
    expect(result.R).toBe(0);
    expect(result.mode).toBe("Risk-on"); // calm tape = entry opportunity
  });

  it("returns 0 for fearGreed component when F&G = 59 (still below neutral=60)", () => {
    const result = computeRiskScore(snapshot(0, 0, 59));
    expect(result.components[2].contribution).toBe(0);
  });
});

// ── Greed raises R ───────────────────────────────────────────────────────────

describe("computeRiskScore — greed raises R", () => {
  it("adds greed premium when F&G = 100 (extreme greed)", () => {
    // fg = max(0, (100-60)/40) * 0.2 = 1.0 * 0.2 = 0.2
    const result = computeRiskScore(snapshot(0, 0, 100));
    expect(result.components[2].contribution).toBeCloseTo(0.2, 5);
  });

  it("adds greed premium when F&G = 80", () => {
    // fg = max(0, (80-60)/40) * 0.2 = 0.5 * 0.2 = 0.1
    const result = computeRiskScore(snapshot(0, 0, 80));
    expect(result.components[2].contribution).toBeCloseTo(0.1, 5);
  });
});

// ── R is clamped to [0, 1] ────────────────────────────────────────────────────

describe("computeRiskScore — clamping", () => {
  it("R is at most 1 even with extreme inputs", () => {
    // All components at max: 0.4 + 0.4 + 0.2 = 1.0
    const result = computeRiskScore(snapshot(100, 100, 100));
    expect(result.R).toBe(1);
  });

  it("R is at least 0 even with zero inputs", () => {
    const result = computeRiskScore(snapshot(0, 0, 0));
    expect(result.R).toBe(0);
  });

  it("both directions of price move raise R equally (absolute value)", () => {
    const up = computeRiskScore(snapshot(3, 0, 0));
    const dn = computeRiskScore(snapshot(-3, 0, 0));
    expect(up.R).toBeCloseTo(dn.R, 10);
  });
});

// ── Mode mapping ──────────────────────────────────────────────────────────────

describe("pickMode", () => {
  it("R=0 → Risk-on, target 80%", () => {
    const r = pickMode(0);
    expect(r.mode).toBe("Risk-on");
    expect(r.targetVolatilePct).toBe(80);
  });

  it("R=0.32 → Risk-on (just below 0.33 threshold)", () => {
    expect(pickMode(0.32).mode).toBe("Risk-on");
  });

  it("R=0.33 → Neutral (at lower threshold)", () => {
    expect(pickMode(0.33).mode).toBe("Neutral");
    expect(pickMode(0.33).targetVolatilePct).toBe(45);
  });

  it("R=0.65 → Neutral (just below 0.66)", () => {
    expect(pickMode(0.65).mode).toBe("Neutral");
  });

  it("R=0.66 → Risk-off (at upper threshold)", () => {
    const r = pickMode(0.66);
    expect(r.mode).toBe("Risk-off");
    expect(r.targetVolatilePct).toBe(18); // NEVER 0 — never-dust invariant
  });

  it("R=1.0 → Risk-off, target 18% (never 0%)", () => {
    const r = pickMode(1.0);
    expect(r.mode).toBe("Risk-off");
    expect(r.targetVolatilePct).toBe(18);
    expect(r.targetVolatilePct).toBeGreaterThan(0); // never-dust
  });
});

// ── Rebalance band ────────────────────────────────────────────────────────────

describe("shouldRebalance", () => {
  it("returns false when within the 5% band (no churn)", () => {
    expect(shouldRebalance(77, 80)).toBe(false); // 3% deviation
    expect(shouldRebalance(83, 80)).toBe(false);
  });

  it("returns true when deviation exceeds 5%", () => {
    expect(shouldRebalance(74, 80)).toBe(true);  // 6% deviation
    expect(shouldRebalance(86, 80)).toBe(true);
  });

  it("returns false when exactly at band boundary (5%)", () => {
    // Deviation must be STRICTLY greater than band to rebalance
    expect(shouldRebalance(75, 80)).toBe(false); // exactly 5%
  });

  it("respects a custom policy band", () => {
    const narrowPolicy = { ...DEFAULT_POLICY, rebalanceBandPct: 2 };
    expect(shouldRebalance(78, 80, narrowPolicy)).toBe(false); // 2% = boundary
    expect(shouldRebalance(77, 80, narrowPolicy)).toBe(true);  // 3% > 2%
  });
});
