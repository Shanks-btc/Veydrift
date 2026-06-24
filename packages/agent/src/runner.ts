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
//                         planned action) but NO live TWAK execution. Day ledger
//                         is NOT updated. Audit entry IS written, tagged dryRun: true.
//
// Required env vars for live execution:
//   I_UNDERSTAND_REAL_FUNDS=yes   Hard gate — must be exact string "yes".
//   BNB_WALLET_PASSWORD           Keystore password. NEVER logged.
//   CMC_PRO_API_KEY               CoinMarketCap Pro API key.
//   PORTFOLIO_VALUE_USD           Only used when TWAK balance fetch fails AND no
//                                 persisted HWM exists. Real balance is fetched
//                                 from the chain on every cycle.
//
// Optional env vars:
//   VOLATILE_VALUE_USD    Fallback only (env-var mode). Ignored when TWAK balance succeeds.
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

import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, writeFileSync } from "fs";

const execAsync = promisify(exec);
import type { ExecutionPlan, ExecutionResult, PortfolioSnapshot } from "@veydrift/shared";
import { runScheduler } from "./loop/scheduler.js";
import {
  loadState,
  saveState,
  getDayKey,
  writePortfolioSnapshot,
  DEFAULT_DATA_DIR,
} from "./state/persistence.js";
import { execute } from "./execution/twak.js";

function parseNum(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

// Dry-run executor: calls execute(plan, "dry-run") which logs the would-be
// command with <keychain> placeholder, then returns a synthetic ok result.
// No spawn occurs; no funds move; no real txHash is produced.
function dryRunExecute(plan: ExecutionPlan): ExecutionResult {
  execute(plan, "dry-run");  // logs command to stdout; returns plan (ignored here)
  return { ok: true };       // no txHash — dry-run produces none
}

// ── ETH price fetch (for volatile valuation in balance computation) ───────────
// Separate from the Hub/REST price the scheduler fetches internally; this call
// is read-only and non-critical. Falls back to 0 on any failure.
async function fetchEthPriceUsd(): Promise<number> {
  const key = process.env["CMC_API_KEY"] ?? process.env["CMC_PRO_API_KEY"];
  if (!key) return 0;
  try {
    const res = await fetch(
      "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=ETH",
      {
        headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      },
    );
    const data = await res.json() as {
      data?: { ETH?: Array<{ quote?: { USD?: { price?: number } } }> };
    };
    const price = data?.data?.ETH?.[0]?.quote?.USD?.price;
    return typeof price === "number" && price > 0 ? price : 0;
  } catch {
    return 0;
  }
}

// ── Real balance fetch via TWAK CLI ──────────────────────────────────────────
// PRIMARY source for portfolio values on every cycle.
// BNB = gas only — included in tokenBalances for display but excluded from
// totalValueUsd (portfolio total = volatile + stable only).
// ETH price comes from a concurrent CMC fetch. CAKE/LINK use 0 if no price.
// Falls back to env vars (caller's responsibility) on any failure.

interface RealBalance {
  totalValueUsd: number;
  volatileValueUsd: number;
  stableValueUsd: number;
  tokenBalances: PortfolioSnapshot["tokenBalances"];
}

const STABLE_SYMS  = new Set(["USDT", "USDC", "USD1", "FDUSD"]);
const VOLATILE_SYMS = new Set(["ETH", "CAKE", "LINK"]);
const ALL_ASSET_SYMS = new Set(["ETH", "CAKE", "LINK", "USDT", "USDC", "USD1", "FDUSD", "BNB"]);
const REDACT_PW_RE = /--password\s+\S+/g;

async function fetchRealBalance(): Promise<RealBalance | null> {
  const password = process.env["BNB_WALLET_PASSWORD"];
  const pwFlag   = password ? ` --password ${password}` : "";
  const cmd      = `npx --yes --package @trustwallet/cli twak wallet balance --chain bsc${pwFlag} --json`;

  // Start ETH price fetch concurrently with the balance call
  const ethPricePromise = fetchEthPriceUsd();

  // Use async exec() — on Windows+Node.js v24 the synchronous variants
  // (execSync, spawnSync) fail with ETIMEDOUT in the tsx runtime due to
  // how they interact with the event loop and OS handle inheritance.
  // exec() is async and uses a different OS code path that works correctly.
  let raw: string;
  try {
    const { stdout } = await execAsync(cmd, { timeout: 15_000, encoding: "utf8" });
    raw = stdout;
  } catch (e) {
    // On Windows, TWAK may exit with code 9 (UV_HANDLE_CLOSING) after writing
    // valid JSON — stdout is still populated on the error object.
    // On Linux/Railway: a genuine failure; err.message may contain the command
    // string including the password — redact before logging.
    const err = e as { stdout?: string; message?: string };
    if (err.stdout) {
      raw = err.stdout; // Windows exit-code-9: stdout has the data
    } else {
      const safeMsg = (err.message ?? String(e)).replace(REDACT_PW_RE, "--password <redacted>");
      console.log(`[veydrift runner] TWAK balance query failed, using env vars: ${safeMsg}`);
      return null;
    }
  }

  try {
    // Banner-tolerant JSON extraction (CLI may print preamble before JSON)
    const jsonStart = raw.indexOf("{");
    const jsonEnd   = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      console.log("[veydrift runner] TWAK balance query failed, using env vars: no JSON in output");
      return null;
    }

    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      symbol?:   string;    // native token, e.g. "BNB"
      total?:    string;    // native token balance
      totalUsd?: number;    // native token USD value only
      tokens?:   Array<{ symbol?: string; balance?: string }>;
    };

    // Await ETH price (fetch was started before execSync, likely already resolved)
    const ethPriceUsd = await ethPricePromise;
    // CAKE and LINK: no separate price fetch — use 0 (honest fallback per spec)
    const VOLATILE_PRICES: Record<string, number> = { ETH: ethPriceUsd };

    let volatileValueUsd = 0;
    let stableValueUsd   = 0;
    const tokenBalances: PortfolioSnapshot["tokenBalances"] = {};

    // ERC-20 tokens
    for (const token of parsed.tokens ?? []) {
      if (!token.symbol || !token.balance) continue;
      const sym = token.symbol.toUpperCase();
      const bal = parseFloat(token.balance);
      if (isNaN(bal) || !ALL_ASSET_SYMS.has(sym)) continue;

      if (STABLE_SYMS.has(sym)) {
        const usdVal = bal; // stablecoins: 1:1 USD
        stableValueUsd += usdVal;
        tokenBalances[sym as keyof PortfolioSnapshot["tokenBalances"]] =
          { balance: bal, valueUsd: usdVal };
      } else if (VOLATILE_SYMS.has(sym)) {
        const price  = VOLATILE_PRICES[sym] ?? 0;
        const usdVal = bal * price;
        volatileValueUsd += usdVal;
        tokenBalances[sym as keyof PortfolioSnapshot["tokenBalances"]] =
          { balance: bal, valueUsd: usdVal };
      }
      // All other ERC-20 tokens: skip (not in allowlist)
    }

    // Native token (BNB): gas reserve — included in tokenBalances for display
    // but NOT added to totalValueUsd (portfolio total = volatile + stable only).
    const nativeSym = (parsed.symbol ?? "BNB").toUpperCase();
    const nativeBal = parseFloat(parsed.total ?? "0");
    if (!isNaN(nativeBal) && nativeBal > 0 && ALL_ASSET_SYMS.has(nativeSym)) {
      const nativeUsd = typeof parsed.totalUsd === "number" ? parsed.totalUsd : 0;
      tokenBalances[nativeSym as keyof PortfolioSnapshot["tokenBalances"]] =
        { balance: nativeBal, valueUsd: nativeUsd };
    }

    const totalValueUsd = volatileValueUsd + stableValueUsd;

    if (totalValueUsd === 0) {
      // Both volatile and stable are 0 — either empty wallet or no price data.
      // Return null so caller falls back to env vars.
      console.log("[veydrift runner] TWAK balance returned zero portfolio value — falling back to env vars");
      return null;
    }

    return { totalValueUsd, volatileValueUsd, stableValueUsd, tokenBalances };
  } catch (e) {
    const safeMsg = String(e).replace(REDACT_PW_RE, "--password <redacted>");
    console.log(`[veydrift runner] TWAK balance parse error, using env vars: ${safeMsg}`);
    return null;
  }
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
  // The scheduler treats any existing dayLedger entry (including BLOCKED) as
  // "already done" and returns SKIPPED on re-invocation. When today's entry is
  // BLOCKED with no real txHash, clear it so one retry is allowed.
  // A per-day marker file caps this at exactly one retry per calendar day —
  // the marker prevents the next hourly invocation from retrying again.
  const todayKey   = getDayKey();
  const todayEntry = state.dayLedger[todayKey];

  if (todayEntry?.status === "BLOCKED" && !todayEntry.txHash) {
    const retryMarker = join(dataDir, `retry-${todayKey}.marker`);
    if (!existsSync(retryMarker)) {
      // First retry: clear today's entry and record the marker
      const patchedState = { ...state, dayLedger: { ...state.dayLedger } };
      delete patchedState.dayLedger[todayKey];
      saveState(patchedState, dataDir);
      writeFileSync(retryMarker, todayKey, "utf8");
      console.log(`[veydrift runner] today (${todayKey}) was BLOCKED — clearing for one retry`);
    } else {
      // Retry already attempted today — do not retry again
      console.log(`[veydrift runner] today (${todayKey}) was BLOCKED and already retried — not retrying again`);
    }
  }

  // ── Real balance from TWAK (primary) or env vars (fallback) ──────────────
  // Real balance is the primary source: reads live on-chain state via TWAK CLI.
  // Env vars are used ONLY when the TWAK call fails (logged with reason).
  // The totalValueUsd === 0 guard fires only when BOTH sources yield nothing.
  let totalValueUsd: number;
  let volatileValueUsd: number;
  let stableValueUsd: number;
  let realTokenBalances: PortfolioSnapshot["tokenBalances"] = {};
  let balanceSource: "twak" | "env" = "env";

  const realBalance = await fetchRealBalance();

  if (realBalance !== null) {
    ({ totalValueUsd, volatileValueUsd, stableValueUsd } = realBalance);
    realTokenBalances = realBalance.tokenBalances;
    balanceSource = "twak";
  } else {
    // TWAK unavailable — fall back to env vars
    totalValueUsd    = parseNum("PORTFOLIO_VALUE_USD", hwm > 0 ? hwm : 0);
    volatileValueUsd = parseNum("VOLATILE_VALUE_USD",  0);
    stableValueUsd   = parseNum(
      "STABLE_VALUE_USD",
      Math.max(0, totalValueUsd - volatileValueUsd),
    );
  }

  // On first run with no real balance AND no env var AND no persisted HWM.
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

  // ── Run ONE scheduler cycle ─────────────────────────────────────────────
  // Live mode: deps minimal — scheduler defaults to real file I/O and
  //   execute(plan, "live") gated by I_UNDERSTAND_REAL_FUNDS=yes + BNB_WALLET_PASSWORD.
  // Dry-run mode: executeTrade is replaced with dryRunExecute; dryRun: true
  //   prevents day-ledger and state writes. Audit entry IS written (tagged dryRun: true).
  const result = await runScheduler({
    totalValueUsd,
    volatileValueUsd,
    stableValueUsd,
    deps: {
      stateDir: dataDir,
      ...(isDryRun
        ? { dryRun: true, executeTrade: dryRunExecute }
        : {}),
    },
  });

  // ── Persist portfolio snapshot for the dashboard ───────────────────────
  try {
    const finalState = loadState(dataDir);
    const hwmUsd = finalState.highWaterMarkUsd;
    const drawdownPct = hwmUsd > 0 ? ((totalValueUsd - hwmUsd) / hwmUsd) * 100 : 0;
    const snapshot: PortfolioSnapshot = {
      snapshotAt: new Date().toISOString(),
      portfolioUsd: totalValueUsd,
      tokenBalances: realTokenBalances,   // real per-token balances from TWAK (empty {} on env fallback)
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

  // ── Log result (BNB_WALLET_PASSWORD never appears here) ─────────────────
  const modeTag = isDryRun ? "[dry-run] " : "";
  console.log(`[veydrift runner] ${modeTag}action=${result.action} · date=${result.date}`);
  if (result.txHash) {
    // BSC tx hash — never a Base/x402 hash
    console.log(`[veydrift runner] ${modeTag}tx=${result.txHash}`);
    console.log(`[veydrift runner] ${modeTag}bscscan=https://bscscan.com/tx/${result.txHash}`);
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
