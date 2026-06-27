// §6 — Single-cycle runner entrypoint.
//
// Runs ONE scheduler cycle and exits. The day ledger makes this idempotent:
// re-invoking on the same calendar day returns SKIPPED — no double-trade.
//
// Intended to be called by a Render Cron Job (or equivalent) on a regular
// cadence (e.g. hourly). The scheduler decides whether to trade or skip.
//
// Flags:
//   --dry-run             Full cycle (signals → engine → overlays → gates →
//                         planned action) but NO live Bitget execution. Day ledger
//                         is NOT updated. Audit entry IS written, tagged dryRun: true.
//
// Required env vars for live execution:
//   I_UNDERSTAND_REAL_FUNDS=yes   Hard gate — must be exact string "yes".
//   BITGET_API_KEY                Bitget REST API key.
//   BITGET_SECRET_KEY             Bitget HMAC signing secret.
//   BITGET_PASSPHRASE             Bitget API passphrase.
//   PORTFOLIO_VALUE_USD           Only used when Bitget balance fetch fails AND no
//                                 persisted HWM exists. Real balance is fetched
//                                 from Bitget on every cycle.
//
// Optional env vars:
//   VOLATILE_VALUE_USD    Fallback only (env-var mode). Ignored when Bitget balance succeeds.
//   STABLE_VALUE_USD      Fallback only (env-var mode).
//   KEEL_DRY_RUN=1        Alternative to --dry-run flag (same effect).
//   KEEL_DATA_DIR         State/audit directory (default: ./data).
//   HUB_ENABLED=yes       Enable CMC Agent Hub MCP (non-critical path: failure
//                         falls back to REST — never blocks qualification).
//   X402_ENABLED=yes      Enable x402 paid-call layer (non-critical path:
//                         failure is logged and skipped — never blocks).

// Load .env from repo root before any process.env reads
import { config as loadDotEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(__dirname, "../../../.env") });

import { existsSync, writeFileSync } from "fs";

import type { ExecutionPlan, ExecutionResult, PortfolioSnapshot } from "@veydrift/shared";
import { runScheduler } from "./loop/scheduler.js";
import {
  loadState,
  saveState,
  getDayKey,
  writePortfolioSnapshot,
  DEFAULT_DATA_DIR,
} from "./state/persistence.js";
import { fetchBitgetSnapshot, fetchBitgetSignals } from "./perception/bitget-signals.js";
import { executeBitgetOrder, getAccountBalance } from "./execution/bitget.js";
import { DEFAULT_POLICY } from "./config.js";

function parseNum(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

// Stable asset symbols — used to classify proposal legs.
const STABLES = new Set(["USDT", "USDC", "USD1", "FDUSD"]);

// Dry-run executor: logs the would-be Bitget order, returns a synthetic ok result.
// No HTTP call is made; no funds move.
function dryRunExecute(plan: ExecutionPlan): ExecutionResult {
  const { proposal } = plan;
  const isEth = proposal.fromAsset === "ETH" || proposal.toAsset === "ETH";
  const symbol: "BTCUSDT" | "ETHUSDT" = isEth ? "ETHUSDT" : "BTCUSDT";
  const side: "buy" | "sell" = STABLES.has(proposal.fromAsset) ? "buy" : "sell";
  console.log(
    `[veydrift dry-run] would executeBitgetOrder · ${side} ${symbol} ` +
    `size=${proposal.amountIn.toFixed(4)} (${proposal.reason.slice(0, 60)})`,
  );
  return { ok: true };
}

async function main(): Promise<void> {
  const isDryRun =
    process.argv.includes("--dry-run") ||
    process.env["KEEL_DRY_RUN"] === "1";

  const dataDir = process.env["KEEL_DATA_DIR"] ?? DEFAULT_DATA_DIR;

  // ── Determine portfolio values ──────────────────────────────────────────
  const state = loadState(dataDir);
  const hwm   = state.highWaterMarkUsd;

  // ── BLOCKED retry: clear today's BLOCKED entry so the scheduler retries ──
  const todayKey   = getDayKey();
  const todayEntry = state.dayLedger[todayKey];

  if (todayEntry?.status === "BLOCKED" && !todayEntry.txHash) {
    const retryMarker = join(dataDir, `retry-${todayKey}.marker`);
    if (!existsSync(retryMarker)) {
      const patchedState = { ...state, dayLedger: { ...state.dayLedger } };
      delete patchedState.dayLedger[todayKey];
      saveState(patchedState, dataDir);
      writeFileSync(retryMarker, todayKey, "utf8");
      console.log(`[veydrift runner] today (${todayKey}) was BLOCKED — clearing for one retry`);
    } else {
      console.log(`[veydrift runner] today (${todayKey}) was BLOCKED and already retried — not retrying again`);
    }
  }

  // ── Balance from Bitget (primary) or env vars (fallback) ─────────────────
  // Fetch balance and market signals concurrently; both are non-critical.
  // fetchBitgetSignals warms the perception cache used by the scheduler loop.
  let totalValueUsd: number;
  let volatileValueUsd: number;
  let stableValueUsd: number;
  let balanceSource: "twak" | "env" = "env";

  const [bitgetBalResult] = await Promise.allSettled([
    getAccountBalance(),
    fetchBitgetSignals(),
  ]);

  const bitgetBal = bitgetBalResult.status === "fulfilled" ? bitgetBalResult.value : null;

  if (bitgetBal !== null) {
    totalValueUsd    = bitgetBal.totalUsdt;
    volatileValueUsd = bitgetBal.btcUsdt + bitgetBal.ethUsdt;
    stableValueUsd   = bitgetBal.usdtTotal;
    balanceSource    = "twak"; // live source (field reused for type compat)
  } else {
    // Bitget balance unavailable — fall back to env vars
    totalValueUsd    = parseNum("PORTFOLIO_VALUE_USD", hwm > 0 ? hwm : 0);
    volatileValueUsd = parseNum("VOLATILE_VALUE_USD",  0);
    stableValueUsd   = parseNum(
      "STABLE_VALUE_USD",
      Math.max(0, totalValueUsd - volatileValueUsd),
    );
  }

  if (totalValueUsd === 0) {
    console.error(
      "[veydrift runner] PORTFOLIO_VALUE_USD is not set and no persisted HWM found.\n" +
      "              Set PORTFOLIO_VALUE_USD=<total wallet value in USD> and re-run.\n" +
      "              Example: PORTFOLIO_VALUE_USD=500 npm run run:cycle",
    );
    process.exit(1);
  }

  if (isDryRun) {
    console.log("[veydrift runner] DRY-RUN mode — no funds will move · day ledger not updated");
  }
  console.log(`[veydrift runner] cycle start · ${new Date().toISOString()}`);
  console.log(
    `[veydrift runner] portfolio  total=$${totalValueUsd.toFixed(2)} ` +
    `volatile=$${volatileValueUsd.toFixed(2)} ` +
    `stable=$${stableValueUsd.toFixed(2)} (${balanceSource})`,
  );
  console.log(`[veydrift runner] HWM=$${hwm.toFixed(2)} · data=${dataDir}`);

  // ── Live Bitget executor ────────────────────────────────────────────────
  // The scheduler's executeTrade interface is synchronous; executeBitgetOrder
  // is async. Bridge: fire the request immediately (no await), return an
  // optimistic { ok: true } to the scheduler so it records EXECUTED, then
  // await the real result below. The orderId is logged post-scheduler.
  //
  // Object holder avoids TypeScript's closure-narrowing of let variables:
  // TypeScript doesn't narrow object property reads the same aggressive way.
  const inflight: { promise: Promise<ExecutionResult> | null } = { promise: null };

  function liveExecute(plan: ExecutionPlan): ExecutionResult {
    const { proposal } = plan;

    if (STABLES.has(proposal.fromAsset) && STABLES.has(proposal.toAsset)) {
      // Stable-to-stable (fallback path): not a Bitget spot pair
      return {
        ok: false,
        error: `Stable-to-stable not supported on Bitget: ${proposal.fromAsset}→${proposal.toAsset}`,
      };
    }

    if (!STABLES.has(proposal.fromAsset) && !STABLES.has(proposal.toAsset)) {
      return {
        ok: false,
        error: `Non-USD pair not supported: ${proposal.fromAsset}→${proposal.toAsset}`,
      };
    }

    const isEth = proposal.fromAsset === "ETH" || proposal.toAsset === "ETH";
    const symbol: "BTCUSDT" | "ETHUSDT" = isEth ? "ETHUSDT" : "BTCUSDT";
    const side: "buy" | "sell" = STABLES.has(proposal.fromAsset) ? "buy" : "sell";

    console.log(
      `[veydrift runner] firing Bitget order · ${side} ${symbol} ` +
      `size=${proposal.amountIn.toFixed(4)}`,
    );
    inflight.promise = executeBitgetOrder({ symbol, side, size: proposal.amountIn });
    return { ok: true }; // optimistic; real result awaited after runScheduler
  }

  // ── Run ONE scheduler cycle ─────────────────────────────────────────────
  const result = await runScheduler({
    totalValueUsd,
    volatileValueUsd,
    stableValueUsd,
    policy: {
      ...DEFAULT_POLICY,
      riskOnTargetPct: 50,        // reduced from 80 for Bitget spot
      neutralTargetPct: 35,       // reduced from 45
      // riskOffTargetPct stays at 18
      perTradeCapFraction: 0.25,  // max 25% of portfolio per trade — meets Bitget $1 minimum
      fallbackSwapSizeUsd: 1.0,   // fallback stable swap size — meets Bitget $1 minimum
      rebalanceBandPct: 8,        // wider band to reduce churn on small portfolio
      killSwitchPct: -25,         // updated kill-switch for Veydrift
      drawdownAlertPct: -15,      // updated alert threshold
    },
    deps: {
      stateDir: dataDir,
      restFetcher: () => fetchBitgetSnapshot("ETHUSDT"),
      ...(isDryRun
        ? { dryRun: true, executeTrade: dryRunExecute }
        : { executeTrade: liveExecute }),
    },
  });

  // ── Await actual Bitget result (fired inside liveExecute above) ──────────
  // Read property into a const — property reads are not closure-narrowed,
  // so TypeScript can safely narrow past the null check.
  const inflightPromise = inflight.promise;
  if (!isDryRun && inflightPromise !== null) {
    const finalBitget = await inflightPromise;
    if (finalBitget.ok) {
      console.log(`[veydrift runner] Bitget order confirmed · orderId=${finalBitget.txHash ?? "unknown"}`);
    } else {
      console.error(`[veydrift runner] Bitget order failed: ${finalBitget.error ?? "unknown"}`);
    }
  }

  // ── Persist portfolio snapshot for the dashboard ───────────────────────
  try {
    const finalState = loadState(dataDir);
    const hwmUsd = finalState.highWaterMarkUsd;
    const drawdownPct = hwmUsd > 0 ? ((totalValueUsd - hwmUsd) / hwmUsd) * 100 : 0;
    const snapshot: PortfolioSnapshot = {
      snapshotAt: new Date().toISOString(),
      portfolioUsd: totalValueUsd,
      tokenBalances: {}, // Bitget balance is USD-aggregated; per-token detail not yet mapped
      allocation: {
        volatilePct: totalValueUsd > 0 ? (volatileValueUsd / totalValueUsd) * 100 : 0,
        stablePct:   totalValueUsd > 0 ? (stableValueUsd   / totalValueUsd) * 100 : 0,
        gasPct: 0,
      },
      hwm: hwmUsd,
      currentDrawdownPct: drawdownPct,
      lastBscTxHash: result.txHash ?? null,
      lastCycleResult: result.action,
      source: balanceSource,
    };
    writePortfolioSnapshot(snapshot, dataDir);
  } catch {
    // Snapshot write failure is non-fatal — runner cycle already completed
  }

  // ── Log result ──────────────────────────────────────────────────────────
  const modeTag = isDryRun ? "[dry-run] " : "";
  console.log(`[veydrift runner] ${modeTag}action=${result.action} · date=${result.date}`);
  if (result.txHash) {
    console.log(`[veydrift runner] ${modeTag}orderId=${result.txHash}`);
  }
  if (result.blockedReason) {
    console.log(`[veydrift runner] ${modeTag}blocked: ${result.blockedReason}`);
  }

  console.log(`[veydrift runner] ${modeTag}cycle complete`);
  process.exit(0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[veydrift runner] fatal: ${msg}`);
  process.exit(1);
});
