// Server-side API route — portfolio balance with LIVE/STALE/UNAVAILABLE freshness.
// Priority order:
//   1. Bitget balance query (server-side, 5-min TTL cache) — real CEX balances
//      + Bitget public ticker for volatile token prices (concurrent, gracefully degraded)
//   2. data/portfolio-snapshot.json — written by the runner after every cycle
//   3. env vars PORTFOLIO_VALUE_USD / VOLATILE_VALUE_USD / STABLE_VALUE_USD (labeled SIMULATION)
//   4. null — "Awaiting first live portfolio snapshot" (NEVER fake numbers)
//
// Freshness rules (applied to snapshot.snapshotAt):
//   LIVE        snapshot < 2h old + successful fetch this request
//   STALE       snapshot 2-24h old, or Bitget failed but snapshot exists
//   UNAVAILABLE no snapshot and no env vars
//
// Side-effects on successful real-data reads (source === "bitget"):
//   data/pnl-baseline.json    — written once, never overwritten (first real snapshot)
//   data/drawdown-history.json — bounded 200-entry time series appended each read

import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { PortfolioSnapshot, PortfolioFreshness, DrawdownPoint } from "@veydrift/shared";
import { applyDrawdownPoint } from "../../../lib/drawdown-history";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.KEEL_DATA_DIR ?? resolve(process.cwd(), "../../data");

const BITGET_BASE  = "https://api.bitget.com";
const BALANCE_PATH = "/api/v2/spot/account/assets";

// Asset classification
const STABLES = new Set(["USDT", "USDC", "USD1", "FDUSD"]);

// 5-minute TTL cache for Bitget balance fetches
let bitgetCache: { snapshot: PortfolioSnapshot; cachedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const BASELINE_FILE   = join(DATA_DIR, "pnl-baseline.json");
const DD_HISTORY_FILE = join(DATA_DIR, "drawdown-history.json");

// ── PnL baseline (write-once) ────────────────────────────────────────────────

export interface PnlBaseline {
  firstSnapshotUsd: number;
  firstSnapshotAt: string;
}

function readBaseline(): PnlBaseline | null {
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as PnlBaseline;
  } catch { return null; }
}

function persistBaselineOnce(usd: number, at: string): PnlBaseline | null {
  try {
    const existing = readBaseline();
    if (existing) return existing;           // never overwrite
    const baseline: PnlBaseline = { firstSnapshotUsd: usd, firstSnapshotAt: at };
    writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2), "utf8");
    return baseline;
  } catch { return null; }
}

// ── Drawdown history (bounded 200-entry time series) ─────────────────────────

function readDrawdownHistory(): DrawdownPoint[] {
  try {
    return JSON.parse(readFileSync(DD_HISTORY_FILE, "utf8")) as DrawdownPoint[];
  } catch { return []; }
}

function appendDrawdownPoint(point: DrawdownPoint): DrawdownPoint[] {
  try {
    const history = readDrawdownHistory();
    const updated = applyDrawdownPoint(history, point);
    if (updated !== history) {
      writeFileSync(DD_HISTORY_FILE, JSON.stringify(updated, null, 2), "utf8");
    }
    return updated;
  } catch {
    return readDrawdownHistory();
  }
}

// ── Snapshot file ─────────────────────────────────────────────────────────────

function readSnapshotFile(): PortfolioSnapshot | null {
  try {
    return JSON.parse(
      readFileSync(join(DATA_DIR, "portfolio-snapshot.json"), "utf8"),
    ) as PortfolioSnapshot;
  } catch {
    return null;
  }
}

function parseEnvNum(key: string): number {
  const n = parseFloat(process.env[key] ?? "");
  return isNaN(n) ? 0 : n;
}

// ── Bitget balance fetch ──────────────────────────────────────────────────────

async function fetchSpotPrice(symbol: string): Promise<number> {
  try {
    const res = await fetch(
      `${BITGET_BASE}/api/v2/spot/market/tickers?symbol=${symbol}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const j = await res.json() as { code: string; data: Array<{ lastPr: string }> };
    if (j.code !== "00000") return 0;
    const p = parseFloat(j.data?.[0]?.lastPr ?? "0");
    return isNaN(p) ? 0 : p;
  } catch { return 0; }
}

async function fetchBitgetBalance(): Promise<{ snapshot: PortfolioSnapshot | null; error: string | null }> {
  const apiKey     = process.env["BITGET_API_KEY"];
  const secret     = process.env["BITGET_SECRET_KEY"];
  const passphrase = process.env["BITGET_PASSPHRASE"];

  if (!apiKey || !secret || !passphrase) {
    return { snapshot: null, error: "Bitget credentials not configured" };
  }

  const timestamp = String(Date.now());
  const message   = timestamp + "GET" + BALANCE_PATH;
  const sign      = createHmac("sha256", secret).update(message).digest("base64");

  try {
    // Fetch balance + ETH/BTC prices concurrently
    const [balRes, ethPrice, btcPrice] = await Promise.all([
      fetch(`${BITGET_BASE}${BALANCE_PATH}`, {
        headers: {
          "ACCESS-KEY":        apiKey,
          "ACCESS-SIGN":       sign,
          "ACCESS-TIMESTAMP":  timestamp,
          "ACCESS-PASSPHRASE": passphrase,
          "locale":            "en-US",
        },
        signal: AbortSignal.timeout(15_000),
      }),
      fetchSpotPrice("ETHUSDT"),
      fetchSpotPrice("BTCUSDT"),
    ]);

    const balJson = await balRes.json() as {
      code: string;
      msg?: string;
      data: Array<{ coin: string; available: string; frozen: string; locked?: string }>;
    };

    if (balJson.code !== "00000") {
      return { snapshot: null, error: `Bitget API error: ${balJson.code} ${balJson.msg ?? ""}` };
    }

    function coinTotal(coin: string): number {
      const entry = balJson.data.find(a => a.coin === coin);
      if (!entry) return 0;
      const avail  = parseFloat(entry.available ?? "0");
      const frozen = parseFloat(entry.frozen    ?? "0");
      const locked = parseFloat(entry.locked    ?? "0");
      return (isNaN(avail) ? 0 : avail) +
             (isNaN(frozen) ? 0 : frozen) +
             (isNaN(locked) ? 0 : locked);
    }

    const tokenBalances: PortfolioSnapshot["tokenBalances"] = {};
    let volatileUsd = 0;
    let stableUsd   = 0;

    for (const entry of balJson.data) {
      const sym = entry.coin.toUpperCase();
      const bal = coinTotal(sym);
      if (bal <= 0) continue;

      if (STABLES.has(sym)) {
        tokenBalances[sym as keyof PortfolioSnapshot["tokenBalances"]] =
          { balance: bal, valueUsd: bal };
        stableUsd += bal;
      } else if (sym === "ETH") {
        const valueUsd = bal * ethPrice;
        tokenBalances["ETH"] = { balance: bal, valueUsd };
        volatileUsd += valueUsd;
      } else if (sym === "BTC") {
        const valueUsd = bal * btcPrice;
        tokenBalances["BTC"] = { balance: bal, valueUsd };
        volatileUsd += valueUsd;
      }
      // Unlisted tokens (CATS, TOMA, etc.) are intentionally skipped
    }

    const portfolioUsd = volatileUsd + stableUsd;

    let hwm = portfolioUsd;
    try {
      const agentState = JSON.parse(
        readFileSync(join(DATA_DIR, "agent-state.json"), "utf8"),
      ) as { highWaterMarkUsd?: number };
      if (typeof agentState.highWaterMarkUsd === "number" && agentState.highWaterMarkUsd > 0) {
        hwm = agentState.highWaterMarkUsd;
      }
    } catch { /* use portfolioUsd as default */ }

    const currentDrawdownPct = hwm > 0 && portfolioUsd > 0
      ? ((portfolioUsd - hwm) / hwm) * 100
      : 0;

    console.log(
      `[portfolio] Bitget balance · ` +
      `volatile=$${volatileUsd.toFixed(2)} stable=$${stableUsd.toFixed(2)} ` +
      `total=$${portfolioUsd.toFixed(2)} hwm=$${hwm.toFixed(2)} dd=${currentDrawdownPct.toFixed(2)}%`,
    );

    return {
      snapshot: {
        snapshotAt: new Date().toISOString(),
        portfolioUsd,
        tokenBalances,
        allocation: {
          volatilePct: portfolioUsd > 0 ? (volatileUsd / portfolioUsd) * 100 : 0,
          stablePct:   portfolioUsd > 0 ? (stableUsd   / portfolioUsd) * 100 : 0,
          gasPct: 0,
        },
        hwm,
        currentDrawdownPct,
        lastBscTxHash: null,
        lastCycleResult: null,
        source: "bitget",
      },
      error: null,
    };
  } catch (e) {
    return { snapshot: null, error: String(e) };
  }
}

function computeFreshness(snapshotAt: string): PortfolioFreshness {
  const ageMs = Date.now() - new Date(snapshotAt).getTime();
  if (ageMs < 2 * 60 * 60 * 1000) return "LIVE";
  if (ageMs < 24 * 60 * 60 * 1000) return "STALE";
  return "UNAVAILABLE";
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET() {
  let pnlBaseline: PnlBaseline | null = null;
  let drawdownHistory: DrawdownPoint[] = readDrawdownHistory();

  // 1. Try Bitget balance (with 5-min cache)
  const now = Date.now();
  if (bitgetCache && now - bitgetCache.cachedAt < CACHE_TTL_MS) {
    const freshness = computeFreshness(bitgetCache.snapshot.snapshotAt);
    pnlBaseline = readBaseline();
    return NextResponse.json({
      ok: true,
      snapshot: bitgetCache.snapshot,
      freshness,
      source: "bitget-cache",
      pnlBaseline,
      drawdownHistory,
    });
  }

  console.log("[portfolio] attempting live Bitget balance query");
  const { snapshot: bitgetSnapshot, error: bitgetError } = await fetchBitgetBalance();

  if (bitgetSnapshot) {
    bitgetCache = { snapshot: bitgetSnapshot, cachedAt: now };

    pnlBaseline = persistBaselineOnce(bitgetSnapshot.portfolioUsd, bitgetSnapshot.snapshotAt);
    drawdownHistory = appendDrawdownPoint({
      timestamp: bitgetSnapshot.snapshotAt,
      drawdownPct: bitgetSnapshot.currentDrawdownPct,
    });

    return NextResponse.json({
      ok: true,
      snapshot: bitgetSnapshot,
      freshness: "LIVE" as PortfolioFreshness,
      source: "bitget",
      pnlBaseline,
      drawdownHistory,
    });
  }

  console.log(`[portfolio] live query failed: ${bitgetError ?? "unknown error"}`);

  // 2. Fall back to portfolio-snapshot.json (written by runner)
  const fileSnapshot = readSnapshotFile();
  if (fileSnapshot) {
    const freshness = computeFreshness(fileSnapshot.snapshotAt);
    if (freshness !== "UNAVAILABLE") {
      if (fileSnapshot.source === "twak" || fileSnapshot.source === "bitget") {
        pnlBaseline = persistBaselineOnce(fileSnapshot.portfolioUsd, fileSnapshot.snapshotAt);
        drawdownHistory = appendDrawdownPoint({
          timestamp: fileSnapshot.snapshotAt,
          drawdownPct: fileSnapshot.currentDrawdownPct,
        });
      } else {
        pnlBaseline = readBaseline();
      }
      return NextResponse.json({
        ok: true,
        snapshot: fileSnapshot,
        freshness,
        source: "snapshot",
        pnlBaseline,
        drawdownHistory,
      });
    }
  }

  // 3. Fall back to env vars (labeled SIMULATION — never show as real data)
  const envTotal    = parseEnvNum("PORTFOLIO_VALUE_USD");
  const envVolatile = parseEnvNum("VOLATILE_VALUE_USD");
  const envStable   = parseEnvNum("STABLE_VALUE_USD") || Math.max(0, envTotal - envVolatile);

  if (envTotal > 0) {
    const envSnapshot: PortfolioSnapshot = {
      snapshotAt: new Date().toISOString(),
      portfolioUsd: envTotal,
      tokenBalances: {},
      allocation: {
        volatilePct: envTotal > 0 ? (envVolatile / envTotal) * 100 : 0,
        stablePct:   envTotal > 0 ? (envStable   / envTotal) * 100 : 0,
        gasPct: 0,
      },
      hwm: 0,
      currentDrawdownPct: 0,
      lastBscTxHash: null,
      lastCycleResult: null,
      source: "env",
    };
    pnlBaseline = readBaseline();
    return NextResponse.json({
      ok: true,
      snapshot: envSnapshot,
      freshness: "STALE" as PortfolioFreshness,
      source: "env",
      pnlBaseline,
      drawdownHistory,
    });
  }

  // 4. Nothing available
  pnlBaseline = readBaseline();
  return NextResponse.json({
    ok: true,
    snapshot: null,
    freshness: "UNAVAILABLE" as PortfolioFreshness,
    source: "none",
    pnlBaseline,
    drawdownHistory,
  });
}
