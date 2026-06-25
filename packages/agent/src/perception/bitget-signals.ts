// Bitget public REST perception layer — replaces CMC/Hub price fetches.
// No authentication required for these public endpoints.
//
// Price source:   GET /api/v2/spot/market/tickers?symbol=<BTCUSDT|ETHUSDT>
// Sentiment proxy: GET /api/v2/mix/market/current-fund-rate?symbol=BTCUSDT&productType=USDT-FUTURES
//   Funding rate → Fear & Greed scale (0-100):
//     positive rate = longs paying shorts = greed (>50)
//     negative rate = shorts paying longs = fear (<50)
//     formula: clamp(50 + fundingRate * 10_000, 0, 100)
//
// Never throws to callers — all errors return last cached value or neutral defaults.

import type { MarketSnapshot } from "@veydrift/shared";

const BITGET_BASE = "https://api.bitget.com";
const FETCH_TIMEOUT_MS = 10_000;

// ── Module-level cache (last known good values) ────────────────────────────────

let _lastBtc: MarketSnapshot | null = null;
let _lastEth: MarketSnapshot | null = null;
let _lastFearGreed = 50;

// One-shot flag: log raw ticker response on first call to verify field names.
let _rawTickerLogged = false;
let _rawFundingLogged = false;

// ── Bitget API response shapes ─────────────────────────────────────────────────

interface BitgetTickerEntry {
  symbol: string;
  lastPr: string;       // last traded price
  change24h: string;    // 24h price change rate, decimal (e.g. "0.0123" = 1.23%)
  open24h: string;      // price 24h ago
  high24h?: string;
  low24h?: string;
  ts?: string;
  [key: string]: unknown; // allow extra fields (logged for verification)
}

interface BitgetTickerResponse {
  code: string;
  msg: string;
  requestTime?: number;
  data: BitgetTickerEntry[];
}

interface BitgetFundingRateEntry {
  symbol: string;
  fundingRate: string;  // decimal, e.g. "0.0001" = 0.01%
  nextFundingTime?: string;
  [key: string]: unknown;
}

interface BitgetFundingRateResponse {
  code: string;
  msg: string;
  requestTime?: number;
  data: BitgetFundingRateEntry[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Spot ticker fetch ──────────────────────────────────────────────────────────

async function fetchTickerData(
  symbol: "BTCUSDT" | "ETHUSDT",
): Promise<{ price: number; change24h: number; change1h: number }> {
  const url = `${BITGET_BASE}/api/v2/spot/market/tickers?symbol=${symbol}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const raw = await res.json() as BitgetTickerResponse;

  // Log raw response on first call and whenever BITGET_DEBUG=yes, so operators
  // can verify actual field names against the parsed values above.
  if (!_rawTickerLogged || process.env["BITGET_DEBUG"] === "yes") {
    console.log(
      `[veydrift signals] raw ticker response (${symbol}):`,
      JSON.stringify(raw).slice(0, 600),
    );
    _rawTickerLogged = true;
  }

  if (raw.code !== "00000") {
    throw new Error(`Bitget API error ${raw.code}: ${raw.msg}`);
  }

  const ticker = raw.data?.[0];
  if (!ticker) throw new Error(`No ticker data in response for ${symbol}`);

  const price = parseFloat(ticker.lastPr);
  if (isNaN(price) || price <= 0) {
    throw new Error(`Invalid price "${ticker.lastPr}" for ${symbol}`);
  }

  // change24h is a decimal rate — multiply by 100 for percentage points.
  // e.g. "0.0123" → 1.23%
  const change24hRaw = parseFloat(ticker.change24h);
  const change24h = isNaN(change24hRaw) ? 0 : change24hRaw * 100;

  // Bitget spot tickers have no 1h change field; open24h is the price 24h ago
  // (not 1h ago), so a genuine 1h approximation isn't possible here.
  // Use 0 — the risk engine weights change1h at 0.4, so a neutral 0 is
  // less wrong than a fabricated number.
  const change1h = 0;

  return { price, change24h, change1h };
}

// ── Funding rate → sentiment proxy ─────────────────────────────────────────────

async function fetchFundingRateFearGreed(): Promise<number> {
  const url =
    `${BITGET_BASE}/api/v2/mix/market/current-fund-rate` +
    `?symbol=BTCUSDT&productType=USDT-FUTURES`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const raw = await res.json() as BitgetFundingRateResponse;

  if (!_rawFundingLogged || process.env["BITGET_DEBUG"] === "yes") {
    console.log(
      "[veydrift signals] raw funding rate response:",
      JSON.stringify(raw).slice(0, 400),
    );
    _rawFundingLogged = true;
  }

  if (raw.code !== "00000") {
    throw new Error(`Bitget funding rate error ${raw.code}: ${raw.msg}`);
  }

  const entry = raw.data?.[0];
  if (!entry) throw new Error("No funding rate data in response");

  const rate = parseFloat(entry.fundingRate);
  if (isNaN(rate)) throw new Error(`Invalid funding rate "${entry.fundingRate}"`);

  // Map to 0-100 scale: neutral at 50, ±0.01% rate moves ±1 point.
  // Typical BTC range: -0.05% to +0.05% → Fear&Greed range: 45-55 (calm)
  // Extreme rates ±0.5% → 0 or 100 (max fear/greed)
  return clamp(50 + rate * 10_000, 0, 100);
}

// ── Public API ─────────────────────────────────────────────────────────────────

// Fetch a complete MarketSnapshot for one symbol.
// Fetches spot price and funding-rate sentiment in parallel.
// Never throws — returns last cached value or neutral defaults on failure.
export async function fetchBitgetSnapshot(
  symbol: "BTCUSDT" | "ETHUSDT",
): Promise<MarketSnapshot> {
  const t0 = Date.now();
  const last = symbol === "BTCUSDT" ? _lastBtc : _lastEth;

  const [tickerResult, fgResult] = await Promise.allSettled([
    fetchTickerData(symbol),
    fetchFundingRateFearGreed(),
  ]);

  if (tickerResult.status === "rejected") {
    console.warn(
      `[veydrift signals] price fetch failed: ${String(tickerResult.reason)}`,
    );
    if (last) return last;
    return {
      symbol,
      price: 0,
      change1h: 0,
      change24h: 0,
      fearGreed: _lastFearGreed,
      fetchedAt: new Date().toISOString(),
    };
  }

  const ticker = tickerResult.value;

  let fearGreed: number;
  if (fgResult.status === "rejected") {
    console.warn(
      `[veydrift signals] fear/greed fetch failed: ${String(fgResult.reason)} ` +
      `— using cached value (${_lastFearGreed})`,
    );
    fearGreed = _lastFearGreed;
  } else {
    fearGreed = fgResult.value;
    _lastFearGreed = fearGreed;
  }

  const snapshot: MarketSnapshot = {
    symbol,
    price: ticker.price,
    change1h: ticker.change1h,
    change24h: ticker.change24h,
    fearGreed,
    fetchedAt: new Date().toISOString(),
  };

  if (symbol === "BTCUSDT") _lastBtc = snapshot;
  else _lastEth = snapshot;

  console.log(
    `[veydrift signals] price ok · ${symbol}=$${ticker.price.toFixed(2)} ` +
    `24h=${ticker.change24h.toFixed(2)}% · ${Date.now() - t0}ms`,
  );

  return snapshot;
}

// Fetch signals for both BTC and ETH in parallel.
// Never throws — individual failures fall back to cached or neutral values.
export async function fetchBitgetSignals(): Promise<{
  btc: MarketSnapshot;
  eth: MarketSnapshot;
  fearGreed: number;
}> {
  const [btc, eth] = await Promise.all([
    fetchBitgetSnapshot("BTCUSDT"),
    fetchBitgetSnapshot("ETHUSDT"),
  ]);

  return {
    btc,
    eth,
    fearGreed: btc.fearGreed, // BTC funding rate is the shared sentiment proxy
  };
}

// Quick connectivity check — resolves true when Bitget spot API is reachable.
export async function isBitgetReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(
        `${BITGET_BASE}/api/v2/spot/market/tickers?symbol=BTCUSDT`,
        { signal: controller.signal },
      );
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
