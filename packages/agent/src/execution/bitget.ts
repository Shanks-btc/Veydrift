// Bitget spot execution layer — direct REST, no MCP server required.
//
// Gate:        I_UNDERSTAND_REAL_FUNDS=yes  (same contract as twak.ts)
// Credentials: BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE
//              — never logged; redacted in all error output.
//
// Signature construction (Bitget v2, confirmed from SSH tests):
//   message = timestamp + method + path + body
//   sign    = base64(HMAC-SHA256(message, BITGET_SECRET_KEY))
//
// dry-run: logs the would-be request body, returns { ok: true }, no HTTP call.

import { createHmac } from "node:crypto";
import type { ExecutionResult } from "@veydrift/shared";

const BITGET_BASE = "https://api.bitget.com";
const ORDER_PATH = "/api/v2/spot/trade/place-order";
const BALANCE_PATH = "/api/v2/spot/account/assets";
const FETCH_TIMEOUT_MS = 15_000;

// ── Exported types ────────────────────────────────────────────────────────────

export interface BitgetOrderParams {
  symbol: "BTCUSDT" | "ETHUSDC";
  side: "buy" | "sell";
  size: number;     // USDT amount for buy; base-asset quantity for sell
  dryRun?: boolean;
}

export interface BitgetBalance {
  btcUsdt: number;    // BTC balance expressed in USD
  ethUsdt: number;    // ETH balance expressed in USD
  usdtTotal: number;  // USDT + USDC combined stable balance
  usdcUsdt: number;   // raw USDC balance
  totalUsdt: number;  // sum of all above
  source: "bitget";
}

// ── Credentials ───────────────────────────────────────────────────────────────

interface Creds {
  apiKey: string;
  secret: string;
  passphrase: string;
}

function getCredentials(): Creds | null {
  const apiKey     = process.env["BITGET_API_KEY"];
  const secret     = process.env["BITGET_SECRET_KEY"];
  const passphrase = process.env["BITGET_PASSPHRASE"];
  if (!apiKey || !secret || !passphrase) return null;
  return { apiKey, secret, passphrase };
}

export function isBitgetConfigured(): boolean {
  return getCredentials() !== null;
}

// ── Signing ───────────────────────────────────────────────────────────────────

function sign(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("base64");
}

function buildAuthHeaders(
  method: string,
  path: string,
  body: string,
  creds: Creds,
): Record<string, string> {
  const timestamp = String(Date.now());
  const message   = timestamp + method + path + body;
  return {
    "ACCESS-KEY":        creds.apiKey,
    "ACCESS-SIGN":       sign(message, creds.secret),
    "ACCESS-TIMESTAMP":  timestamp,
    "ACCESS-PASSPHRASE": creds.passphrase,
    "Content-Type":      "application/json",
    "locale":            "en-US",
  };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

// Plain init type — avoids direct use of RequestInit/Response as type annotations
// (same pre-existing ambient-type issue as bitget-signals.ts and hub.ts).
type PlainInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

async function fetchJson<T>(url: string, init: PlainInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

// ── Internal price fetch (for balance USD conversion) ─────────────────────────

async function getSpotPriceUsd(symbol: "BTCUSDT" | "ETHUSDT"): Promise<number> {
  try {
    const raw = await fetchJson<{
      code: string;
      data: Array<{ lastPr: string }>;
    }>(`${BITGET_BASE}/api/v2/spot/market/tickers?symbol=${symbol}`);
    if (raw.code !== "00000") return 0;
    const price = parseFloat(raw.data?.[0]?.lastPr ?? "0");
    return isNaN(price) ? 0 : price;
  } catch {
    return 0;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

// Place a market spot order on Bitget.
// dry-run: logs the request body, skips HTTP call and all credential/gate checks.
// live: requires I_UNDERSTAND_REAL_FUNDS=yes + valid credentials.
// txHash field is reused to hold the Bitget orderId.
export async function executeBitgetOrder(
  params: BitgetOrderParams,
): Promise<ExecutionResult> {
  const { symbol, side, size, dryRun = false } = params;

  const clientOid = `vd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const body = JSON.stringify({
    symbol,
    side,
    orderType: "market",
    force:     "gtc",
    size:      parseFloat(size.toFixed(4)).toString(),
    clientOid,
  });

  // Dry-run: no credential or gate check — just log and return.
  if (dryRun) {
    console.log(
      `[veydrift bitget] dry-run order · ${side} ${symbol} size=${size} clientOid=${clientOid}`,
    );
    console.log(`[veydrift bitget] dry-run: would POST ${ORDER_PATH} body=${body}`);
    return { ok: true };
  }

  // Live path: credential check then I_UNDERSTAND_REAL_FUNDS gate.
  const creds = getCredentials();
  if (!creds) {
    return {
      ok: false,
      error: "Bitget credentials not configured — set BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE",
    };
  }

  if (process.env["I_UNDERSTAND_REAL_FUNDS"] !== "yes") {
    return { ok: false, error: "I_UNDERSTAND_REAL_FUNDS not set to 'yes'" };
  }

  console.log(
    `[veydrift bitget] live order · ${side} ${symbol} size=${size} clientOid=${clientOid}`,
  );

  try {
    const headers = buildAuthHeaders("POST", ORDER_PATH, body, creds);
    const raw = await fetchJson<{
      code: string;
      msg:  string;
      data?: { orderId?: string; clientOid?: string };
    }>(`${BITGET_BASE}${ORDER_PATH}`, { method: "POST", headers, body });

    if (raw.code !== "00000") {
      console.warn(`[veydrift bitget] order failed: code=${raw.code} msg=${raw.msg}`);
      return { ok: false, error: `Bitget order error ${raw.code}: ${raw.msg}` };
    }

    const orderId = raw.data?.orderId ?? raw.data?.clientOid ?? clientOid;
    console.log(`[veydrift bitget] order placed · orderId=${orderId}`);
    return { ok: true, txHash: orderId };
  } catch (err) {
    const msg = String(err);
    console.warn(`[veydrift bitget] order request failed: ${msg}`);
    return { ok: false, error: msg };
  }
}

// Fetch account balances and convert to USD using live spot prices.
// Returns null on any error — never throws.
export async function getAccountBalance(): Promise<BitgetBalance | null> {
  const creds = getCredentials();
  if (!creds) return null;

  try {
    const headers = buildAuthHeaders("GET", BALANCE_PATH, "", creds);

    // Fetch balance + prices concurrently
    const [balResult, btcPriceResult, ethPriceResult] = await Promise.allSettled([
      fetchJson<{
        code: string;
        msg:  string;
        data: Array<{ coin: string; available: string; frozen: string; locked?: string }>;
      }>(`${BITGET_BASE}${BALANCE_PATH}`, { headers }),
      getSpotPriceUsd("BTCUSDT"),
      getSpotPriceUsd("ETHUSDT"),
    ]);

    if (balResult.status === "rejected") {
      console.warn(`[veydrift bitget] balance fetch failed: ${String(balResult.reason)}`);
      return null;
    }

    const raw = balResult.value;
    if (raw.code !== "00000") {
      console.warn(`[veydrift bitget] balance API error: ${raw.code} ${raw.msg}`);
      return null;
    }

    const btcPrice = btcPriceResult.status === "fulfilled" ? btcPriceResult.value : 0;
    const ethPrice = ethPriceResult.status === "fulfilled" ? ethPriceResult.value : 0;

    function coinBalance(coin: string): number {
      const entry = raw.data.find(a => a.coin === coin);
      if (!entry) return 0;
      const avail  = parseFloat(entry.available ?? "0");
      const frozen = parseFloat(entry.frozen   ?? "0");
      const locked = parseFloat(entry.locked   ?? "0");
      return (isNaN(avail) ? 0 : avail) +
             (isNaN(frozen) ? 0 : frozen) +
             (isNaN(locked) ? 0 : locked);
    }

    const btcBal  = coinBalance("BTC");
    const ethBal  = coinBalance("ETH");
    const usdtBal = coinBalance("USDT");
    const usdcBal = coinBalance("USDC");

    const btcUsdt    = btcBal * btcPrice;
    const ethUsdt    = ethBal * ethPrice;
    const stableBal  = usdtBal + usdcBal;
    const totalUsdt  = btcUsdt + ethUsdt + stableBal;

    console.log(
      `[veydrift bitget] balance · ` +
      `BTC=$${btcUsdt.toFixed(2)} ETH=$${ethUsdt.toFixed(2)} ` +
      `USDT=$${usdtBal.toFixed(2)} USDC=$${usdcBal.toFixed(2)} · total=$${totalUsdt.toFixed(2)}`,
    );

    return {
      btcUsdt,
      ethUsdt,
      usdtTotal: stableBal,
      usdcUsdt: usdcBal,
      totalUsdt,
      source: "bitget",
    };
  } catch (err) {
    console.warn(`[veydrift bitget] balance error: ${String(err)}`);
    return null;
  }
}
