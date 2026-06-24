// Server-side API route — portfolio balance with LIVE/STALE/UNAVAILABLE freshness.
// Priority order:
//   1. TWAK balance query (server-side, 5-min TTL cache) — real BSC on-chain data
//      + CMC price fetch for volatile tokens (concurrent, gracefully degraded)
//   2. data/portfolio-snapshot.json — written by the runner after every cycle
//   3. env vars PORTFOLIO_VALUE_USD / VOLATILE_VALUE_USD / STABLE_VALUE_USD (labeled SIMULATION)
//   4. null — "Awaiting first live portfolio snapshot" (NEVER fake numbers)
//
// Freshness rules (applied to snapshot.snapshotAt):
//   LIVE        snapshot < 2h old + successful fetch this request
//   STALE       snapshot 2-24h old, or TWAK failed but snapshot exists
//   UNAVAILABLE no snapshot and no env vars
//
// Side-effects on successful real-data reads (source === "twak"):
//   data/pnl-baseline.json    — written once, never overwritten (first real snapshot)
//   data/drawdown-history.json — bounded 200-entry time series appended each read

import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import type { PortfolioSnapshot, PortfolioFreshness, DrawdownPoint } from "@veydrift/shared";
import { applyDrawdownPoint } from "../../../lib/drawdown-history";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.KEEL_DATA_DIR ?? resolve(process.cwd(), "../../data");

// Asset classification sets (module-level — shared across functions)
const STABLES = new Set(["USDT", "USDC", "USD1", "FDUSD"]);
const GAS     = new Set(["BNB"]);
// Volatile allowlist assets that need CMC prices (BNB handled by TWAK's own totalUsd)
const VOLATILE_SYMS = ["ETH", "CAKE", "LINK"] as const;

// 5-minute TTL cache for TWAK balance fetches (avoids hammering the CLI on every page load)
let twakCache: { snapshot: PortfolioSnapshot; cachedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const BASELINE_FILE   = join(DATA_DIR, "pnl-baseline.json");
const DD_HISTORY_FILE = join(DATA_DIR, "drawdown-history.json");

// ── Password redaction ────────────────────────────────────────────────────────
// Applied to every error string that originates from an execSync call that
// includes --password. Node embeds the full command (incl. password) in the
// error message when execSync throws — this regex strips it before the string
// is logged, returned to callers, or surfaced to the dashboard.
// Same pattern as packages/agent/src/execution/twak.ts executeLive().

const REDACT_PW_RE = /--password\s+\S+/g;
function redactPassword(s: string): string {
  return s.replace(REDACT_PW_RE, "--password <redacted>");
}

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
    // Only write if something actually changed (dedup returns same ref when skipped)
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

// ── CMC volatile prices ───────────────────────────────────────────────────────

// Fetch USD prices for volatile allowlist tokens from CMC REST API.
// Returns an empty Map on any failure — caller treats missing entries as $0.
// Tries CMC_PRO_API_KEY first (web convention), then CMC_API_KEY (agent convention).
async function fetchVolatilePrices(): Promise<Map<string, { price: number; change24hPct: number | null }>> {
  const key = process.env.CMC_PRO_API_KEY ?? process.env.CMC_API_KEY;
  if (!key) return new Map();

  try {
    const syms = VOLATILE_SYMS.join(",");
    const res = await fetch(
      `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${syms}`,
      {
        headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      },
    );
    const data = await res.json() as {
      data?: Record<string, Array<{ quote?: { USD?: { price?: number; percent_change_24h?: number } } }>>;
    };

    const out = new Map<string, { price: number; change24hPct: number | null }>();
    for (const sym of VOLATILE_SYMS) {
      const arr = data?.data?.[sym];
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const usd = arr[0]?.quote?.USD;
      const price = usd?.price;
      if (typeof price === "number" && price > 0) {
        const pct = usd?.percent_change_24h;
        out.set(sym, { price, change24hPct: typeof pct === "number" ? pct : null });
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

// ── TWAK balance query ────────────────────────────────────────────────────────

// Real TWAK balance JSON shape (confirmed from live --json output):
//   { chain, address, symbol: "BNB", available, total, totalUsd, tokens: [{symbol, contract, balance}] }
// Notes:
//   - totalUsd is the NATIVE BNB value only, NOT the full portfolio.
//   - tokens[] has NO per-token USD values — TWAK does not return them.
//   - Stablecoins (USDT/USDC/USD1/FDUSD) are approximated 1:1 USD.
//   - Volatile tokens (ETH, CAKE, LINK) start at valueUsd=0; enriched by applyVolatilePrices().
//   - portfolioUsd before enrichment = BNB USD + stable USD only.
//
// BNB_WALLET_PASSWORD is read from env and passed as --password when set.
// On Windows dev without BNB_WALLET_PASSWORD, TWAK falls back to the OS keychain
// (Windows Credential Manager) — but that keychain does not exist on Railway,
// so the explicit --password flag is required there.
// On Windows, the CLI may exit with code 9 (UV_HANDLE_CLOSING assertion) after
// writing valid JSON; we extract stdout from the thrown error in that case.
//
// SECURITY: every error string that could contain the command line (and therefore
// the password) is passed through redactPassword() before being returned or logged.
function fetchTwakBalance(): { snapshot: PortfolioSnapshot | null; error: string | null } {
  // Read password — passed explicitly so Railway (no OS keychain) works.
  // Falls through to no --password flag when unset, preserving OS-keychain
  // behaviour for local dev environments that haven't set BNB_WALLET_PASSWORD.
  const password = process.env["BNB_WALLET_PASSWORD"];
  const pwArgs   = password ? ` --password ${password}` : "";
  const cmd      = `npx --yes --package @trustwallet/cli twak wallet balance --chain bsc${pwArgs} --json`;

  try {
    let raw = "";
    try {
      raw = execSync(cmd, { timeout: 15_000, encoding: "utf8" });
    } catch (e) {
      // Windows: process exits with code 9 after JSON is written — stdout still has the data.
      // Non-Windows failure: err.message embeds the full command string (incl. password) —
      // redact before returning so the password never appears in logs or error responses.
      const err = e as { stdout?: string | Buffer; message?: string };
      raw = typeof err.stdout === "string"
        ? err.stdout
        : Buffer.isBuffer(err.stdout)
        ? err.stdout.toString("utf8")
        : "";
      if (!raw) {
        const safeMsg = redactPassword(err.message ?? String(e));
        return { snapshot: null, error: `execSync failed: ${safeMsg}` };
      }
    }

    // Gate raw-output diagnostic behind TWAK_DEBUG=yes — not printed on every request.
    if (process.env["TWAK_DEBUG"] === "yes") {
      console.log("[portfolio] raw twak output:", raw.slice(0, 800));
    }

    // Banner-tolerant JSON extraction (CLI may print a preamble before the JSON object)
    const jsonStart = raw.indexOf("{");
    const jsonEnd   = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return { snapshot: null, error: `no JSON object found in TWAK output (${raw.length} chars)` };
    }

    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      symbol?:   string;           // native token: "BNB"
      total?:    string;           // native balance
      totalUsd?: number;           // native token USD ONLY
      tokens?:   Array<{
        symbol?:   string;
        contract?: string;
        balance?:  string;         // ERC-20 balance — no USD value returned by TWAK
      }>;
    };

    // Native BNB: use totalUsd as returned by TWAK
    const nativeSym = (parsed.symbol ?? "BNB").toUpperCase();
    const nativeBal = parseFloat(parsed.total ?? "0");
    const nativeUsd = typeof parsed.totalUsd === "number" ? parsed.totalUsd : 0;
    if (isNaN(nativeBal) || nativeUsd <= 0) {
      return {
        snapshot: null,
        error: `invalid native balance: total=${String(parsed.total)}, totalUsd=${String(parsed.totalUsd)}`,
      };
    }

    const tokenBalances: PortfolioSnapshot["tokenBalances"] = {};
    let stableUsd = 0;

    tokenBalances[nativeSym as keyof PortfolioSnapshot["tokenBalances"]] =
      { balance: nativeBal, valueUsd: nativeUsd };

    // ERC-20 tokens: stables ≈ 1:1 USD; volatile tokens stored with valueUsd=0 until enriched
    for (const t of parsed.tokens ?? []) {
      if (!t.symbol || !t.balance) continue;
      const sym = t.symbol.toUpperCase();
      const bal = parseFloat(t.balance);
      if (isNaN(bal)) continue;
      const usdValue = STABLES.has(sym) ? bal : 0;
      tokenBalances[sym as keyof PortfolioSnapshot["tokenBalances"]] =
        { balance: bal, valueUsd: usdValue };
      if (STABLES.has(sym)) stableUsd += usdValue;
    }

    // Pre-enrichment totals (volatile USD = 0 until applyVolatilePrices() is called)
    const portfolioUsd = nativeUsd + stableUsd;

    return {
      snapshot: {
        snapshotAt: new Date().toISOString(),
        portfolioUsd,
        tokenBalances,
        allocation: {
          volatilePct: 0,
          stablePct:   portfolioUsd > 0 ? (stableUsd  / portfolioUsd) * 100 : 0,
          gasPct:      portfolioUsd > 0 ? (nativeUsd  / portfolioUsd) * 100 : 0,
        },
        hwm: 0,
        currentDrawdownPct: 0,
        lastBscTxHash: null,
        lastCycleResult: null,
        source: "twak",
      },
      error: null,
    };
  } catch (e) {
    // Outer catch covers JS logic errors (JSON.parse failures, etc.).
    // Redact defensively in case the error text somehow contains the command.
    return { snapshot: null, error: redactPassword(String(e)) };
  }
}

// ── CMC price enrichment ──────────────────────────────────────────────────────

// Apply CMC prices to volatile token holdings and recalculate portfolioUsd + allocation.
// Returns a new snapshot object — does not mutate the input.
function applyVolatilePrices(
  snap: PortfolioSnapshot,
  prices: Map<string, { price: number; change24hPct: number | null }>,
): PortfolioSnapshot {
  if (prices.size === 0) return snap;

  let volatileUsd = 0;
  let stableUsd   = 0;
  let gasUsd      = 0;

  const enrichedBalances = { ...snap.tokenBalances };

  for (const sym of Object.keys(enrichedBalances)) {
    const entry = enrichedBalances[sym as keyof PortfolioSnapshot["tokenBalances"]];
    if (!entry) continue;

    if (GAS.has(sym)) {
      gasUsd += entry.valueUsd;
    } else if (STABLES.has(sym)) {
      stableUsd += entry.valueUsd;
    } else {
      const priceEntry = prices.get(sym);
      const usdValue = priceEntry !== undefined ? entry.balance * priceEntry.price : entry.valueUsd;
      const change24hPct = priceEntry?.change24hPct ?? null;
      enrichedBalances[sym as keyof PortfolioSnapshot["tokenBalances"]] =
        { ...entry, valueUsd: usdValue, change24hPct };
      volatileUsd += usdValue;
    }
  }

  const portfolioUsd = gasUsd + stableUsd + volatileUsd;
  return {
    ...snap,
    portfolioUsd,
    tokenBalances: enrichedBalances,
    allocation: {
      volatilePct: portfolioUsd > 0 ? (volatileUsd / portfolioUsd) * 100 : 0,
      stablePct:   portfolioUsd > 0 ? (stableUsd   / portfolioUsd) * 100 : 0,
      gasPct:      portfolioUsd > 0 ? (gasUsd       / portfolioUsd) * 100 : 0,
    },
  };
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

  // 1. Try TWAK balance (with 5-min cache)
  const now = Date.now();
  if (twakCache && now - twakCache.cachedAt < CACHE_TTL_MS) {
    const freshness = computeFreshness(twakCache.snapshot.snapshotAt);
    pnlBaseline = readBaseline();
    return NextResponse.json({
      ok: true,
      snapshot: twakCache.snapshot,
      freshness,
      source: "twak-cache",
      pnlBaseline,
      drawdownHistory,
    });
  }

  // Start CMC price fetch BEFORE the blocking execSync in fetchTwakBalance().
  // The HTTP request goes in-flight at the OS level even while execSync holds the JS thread,
  // so by the time execSync returns the CMC response is likely already received.
  const pricePromise = fetchVolatilePrices();

  console.log("[portfolio] attempting live TWAK balance query");
  const { snapshot: twakSnapshot, error: twakError } = fetchTwakBalance();
  const volatilePrices = await pricePromise;

  if (twakSnapshot) {
    const enriched = applyVolatilePrices(twakSnapshot, volatilePrices);
    const tokenCount = Object.keys(enriched.tokenBalances).length;
    console.log(
      `[portfolio] live query succeeded, ${tokenCount} token${tokenCount !== 1 ? "s" : ""}, totalUsd=$${enriched.portfolioUsd.toFixed(2)}`,
    );
    twakCache = { snapshot: enriched, cachedAt: now };

    // Persist baseline (first real snapshot only) and append to history
    pnlBaseline = persistBaselineOnce(enriched.portfolioUsd, enriched.snapshotAt);
    drawdownHistory = appendDrawdownPoint({
      timestamp: enriched.snapshotAt,
      drawdownPct: enriched.currentDrawdownPct,
    });

    return NextResponse.json({
      ok: true,
      snapshot: enriched,
      freshness: "LIVE" as PortfolioFreshness,
      source: "twak",
      pnlBaseline,
      drawdownHistory,
    });
  }

  // twakError is already redacted at source inside fetchTwakBalance() —
  // safe to log directly.
  console.log(`[portfolio] live query failed: ${twakError ?? "unknown error"}`);

  // 2. Fall back to portfolio-snapshot.json (written by runner)
  const fileSnapshot = readSnapshotFile();
  if (fileSnapshot) {
    const freshness = computeFreshness(fileSnapshot.snapshotAt);
    if (freshness !== "UNAVAILABLE") {
      // Only persist baseline/history from runner snapshots that came from TWAK (real data)
      if (fileSnapshot.source === "twak") {
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
    pnlBaseline = readBaseline();  // read-only for env snapshots — never update baseline from env
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
