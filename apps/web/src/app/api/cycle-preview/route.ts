// Server-side API route — runs the §0a risk formula and §4 drawdown-gate logic.
// Fetches live data from Bitget public API (no auth needed); falls back to a neutral
// mock snapshot and returns priceIsSimulation: true.
// Supports ?direction=to-stable for a Rotate to Stables preview.

import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import type { AgentPersistentState, DrawdownGateResult, RiskMode } from "@veydrift/shared";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.KEEL_DATA_DIR ?? resolve(process.cwd(), "../../data");

function readState(): AgentPersistentState | null {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, "agent-state.json"), "utf8")) as AgentPersistentState;
  } catch {
    return null;
  }
}

// §0a risk formula (mirrors risk/engine.ts computeRiskScore)
function computeR(change1h: number, change24h: number, fearGreed: number): number {
  const c1  = Math.min(1, Math.abs(change1h)  /  3) * 0.4;
  const c24 = Math.min(1, Math.abs(change24h) / 10) * 0.4;
  const fg  = Math.max(0, (fearGreed - 60) / 40)   * 0.2;
  return Math.min(1, Math.max(0, c1 + c24 + fg));
}

function pickMode(R: number): { mode: RiskMode; targetVolatilePct: number } {
  if (R < 0.33) return { mode: "Risk-on",  targetVolatilePct: 80 };
  if (R < 0.66) return { mode: "Neutral",  targetVolatilePct: 45 };
  return           { mode: "Risk-off", targetVolatilePct: 18 };
}

// §4 projected-drawdown gate (mirrors loop/drawdown-gate.ts)
function checkDrawdownGate(
  drawdownPct: number,
  currentVolatilePct: number,
  tradeValueUsd: number,
  portfolioValueUsd: number,
  isRiskReducing: boolean,
): DrawdownGateResult {
  if (isRiskReducing) {
    return {
      ok: true,
      guardName: "projected-drawdown",
      reason: "risk-reducing (volatile→stable) — always passes the projected-drawdown gate",
      isRiskReducing: true,
    };
  }
  const projVolatileUsd = (currentVolatilePct / 100) * portfolioValueUsd + tradeValueUsd;
  const projVolatilePct = portfolioValueUsd > 0
    ? (projVolatileUsd / portfolioValueUsd) * 100
    : 0;
  if (drawdownPct <= -14) {
    return {
      ok: false,
      guardName: "projected-drawdown",
      reason: `emergency mode (drawdown ${drawdownPct.toFixed(2)}% ≤ -14%): no new volatile exposure permitted`,
      projectedVolatilePct: projVolatilePct,
      isRiskReducing: false,
    };
  }
  if (drawdownPct <= -8 && projVolatilePct > 45) {
    return {
      ok: false,
      guardName: "projected-drawdown",
      reason: `projected volatile ${projVolatilePct.toFixed(1)}% > overlay cap 45% (drawdown ${drawdownPct.toFixed(2)}%)`,
      projectedVolatilePct: projVolatilePct,
      isRiskReducing: false,
    };
  }
  return {
    ok: true,
    guardName: "projected-drawdown",
    reason: `projected volatile ${projVolatilePct.toFixed(1)}% within safe bounds`,
    projectedVolatilePct: projVolatilePct,
    isRiskReducing: false,
  };
}

// Fallback snapshot used when the Bitget API call fails.
const FALLBACK_SNAPSHOT = { change1h: 0.5, change24h: 2.0, fearGreed: 45, symbol: "ETH", price: 3_400 };

// Fetch live ETH price and BTC funding rate from Bitget public API (no auth needed).
// Returns null on any error — caller falls back to FALLBACK_SNAPSHOT.
async function fetchBitgetSnapshot(): Promise<typeof FALLBACK_SNAPSHOT | null> {
  try {
    const [tickerRes, fundingRes] = await Promise.all([
      fetch("https://api.bitget.com/api/v2/spot/market/tickers?symbol=ETHUSDT", {
        signal: AbortSignal.timeout(8_000),
      }),
      fetch("https://api.bitget.com/api/v2/mix/market/current-fund-rate?symbol=BTCUSDT&productType=USDT-FUTURES", {
        signal: AbortSignal.timeout(8_000),
      }),
    ]);

    const tickerData = await tickerRes.json() as {
      code: string;
      data: Array<{ lastPr: string; change24h: string }>;
    };
    const fundingData = await fundingRes.json() as {
      code: string;
      data: Array<{ fundingRate: string }>;
    };

    if (tickerData.code !== "00000" || !tickerData.data?.[0]) return null;

    const ticker = tickerData.data[0];
    const price = parseFloat(ticker.lastPr ?? "0");
    if (isNaN(price) || price <= 0) return null;

    const change24hRaw = parseFloat(ticker.change24h ?? "0");
    const change24h = isNaN(change24hRaw) ? 0 : change24hRaw * 100;

    const fundingRate = fundingData.code === "00000"
      ? parseFloat(fundingData.data?.[0]?.fundingRate ?? "0")
      : 0;

    let fearGreed: number;
    if (fundingRate > 0.0003) fearGreed = 75;
    else if (fundingRate < -0.0003) fearGreed = 25;
    else fearGreed = 50;

    return { symbol: "ETH", price, change1h: 0, change24h, fearGreed };
  } catch {
    return null;
  }
}

// Gate results for preview — use the same structure as DrawdownGateResult for consistency
interface PreviewGate {
  ok: boolean;
  guardName: string;
  reason: string;
}

export async function GET(request: NextRequest) {
  const direction = new URL(request.url).searchParams.get("direction");
  const state = readState();
  const hwmUsd = state?.highWaterMarkUsd ?? 0;
  const drawdownPct = 0; // unknown without TWAK balance; assume at HWM for preview

  // ── Rotate to Stables preview ─────────────────────────────────────────────
  if (direction === "to-stable") {
    const drawdownGate = checkDrawdownGate(drawdownPct, 50, 100, 10_000, true);
    return NextResponse.json({
      ok: true,
      direction: "to-stable",
      previewLabel: "Preview only — no wallet signing and no BSC transaction submitted",
      priceIsSimulation: true,
      proposal: {
        fromAsset: "ETH",
        toAsset: "USDT",
        rationale:
          "drawdown-resistant volatile→stable rotation — not guaranteed unless organizers confirm stable-to-stable counts; " +
          "actual amount determined at execution time by the scheduler based on current holdings",
      },
      drawdownGate,
      note:
        "Rotate to Stables suppresses the next stable→volatile trade for one scheduler cycle. " +
        "Only live cycles are affected (dry-run cycles never clear the override). " +
        "Eligible stables: USDT, USDC, USD1, FDUSD. Only TWAK submits trades.",
    });
  }

  // ── Standard cycle preview ────────────────────────────────────────────────
  const fetchedAt = new Date().toISOString();
  const liveSnapshot = await fetchBitgetSnapshot();
  const snapshot = liveSnapshot ?? FALLBACK_SNAPSHOT;
  const priceIsSimulation = liveSnapshot === null;
  const dataSource: "live" | "fallback" = liveSnapshot ? "live" : "fallback";

  const R = computeR(snapshot.change1h, snapshot.change24h, snapshot.fearGreed);
  const { mode, targetVolatilePct } = pickMode(R);

  let adjustedTarget = targetVolatilePct;
  let emergencyMode = false;
  const overlaysApplied: string[] = [];
  if (drawdownPct <= -14) {
    adjustedTarget = Math.min(adjustedTarget, 18);
    emergencyMode = true;
    overlaysApplied.push("emergency-mode (cap 18%)");
  } else if (drawdownPct <= -8) {
    adjustedTarget = Math.min(adjustedTarget, 45);
    overlaysApplied.push("drawdown-overlay (cap 45%)");
  }

  const portfolioPreview = 10_000;
  const tradePreview = portfolioPreview * 0.25; // 25% per-trade cap applied
  const volatilePreview = 45;
  const drawdownGate = checkDrawdownGate(drawdownPct, volatilePreview, tradePreview, portfolioPreview, false);

  // ── Kill-switch gate ──────────────────────────────────────────────────────
  const killSwitchGate: PreviewGate = drawdownPct <= -25
    ? {
        ok: false,
        guardName: "kill-switch",
        reason: `kill-switch triggered: drawdown ${drawdownPct.toFixed(2)}% ≤ -25% — no trades permitted`,
      }
    : {
        ok: true,
        guardName: "kill-switch",
        reason: `drawdown ${drawdownPct.toFixed(2)}% above kill-switch threshold (-25%)`,
      };

  // ── Allowlist gate ────────────────────────────────────────────────────────
  // Eligible trading assets: ETH, CAKE, LINK (volatile); USDT, USDC, USD1, FDUSD (stable).
  // BNB is gas-only and never traded. Standard preview targets ETH ↔ USDT.
  const allowlistGate: PreviewGate = {
    ok: true,
    guardName: "allowlist",
    reason: "ETH and USDT are both on the trading allowlist — preview trade is eligible",
  };

  // ── Per-trade cap gate ────────────────────────────────────────────────────
  // Maximum per-trade size is 25% of portfolio value.
  const tradeCapPct = portfolioPreview > 0 ? (tradePreview / portfolioPreview) * 100 : 0;
  const perTradeCapGate: PreviewGate = tradeCapPct <= 25
    ? {
        ok: true,
        guardName: "per-trade-cap",
        reason: `preview trade ${tradeCapPct.toFixed(1)}% of portfolio — within 25% per-trade cap`,
      }
    : {
        ok: false,
        guardName: "per-trade-cap",
        reason: `preview trade ${tradeCapPct.toFixed(1)}% of portfolio — exceeds 25% per-trade cap`,
      };

  // ── Slippage gate ─────────────────────────────────────────────────────────
  // Configured max slippage is 1%. Without a live quote we cannot verify realized slippage.
  const slippageGate: PreviewGate = {
    ok: true,
    guardName: "slippage",
    reason: "configured max slippage 1.0% — not verified without live quote; checked at execution time",
  };

  // ── Outcome ──────────────────────────────────────────────────────────────
  const allGatesPass =
    killSwitchGate.ok && allowlistGate.ok && perTradeCapGate.ok && drawdownGate.ok;
  const outcome = !allGatesPass
    ? "PREVIEW BLOCKED"
    : state?.riskOffOverride?.active
    ? "PREVIEW BLOCKED: risk-off override active"
    : "PREVIEW ALLOWED";

  return NextResponse.json({
    ok: true,
    previewLabel: "Preview only — no wallet signing and no BSC transaction submitted",
    dataSource,
    priceTimestamp: fetchedAt,
    priceIsSimulation,
    snapshot,
    R: +R.toFixed(4),
    mode,
    targetVolatilePct,
    adjustedTarget,
    emergencyMode,
    overlaysApplied,
    drawdownPct,
    hwmUsd,
    killSwitchGate,
    allowlistGate,
    perTradeCapGate,
    slippageGate,
    drawdownGate,
    outcome,
    dayLedger: state?.dayLedger ?? {},
    riskOffOverride: state?.riskOffOverride ?? null,
  });
}
