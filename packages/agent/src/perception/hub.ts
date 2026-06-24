// CMC Agent Hub (MCP) client — beta, read-only, feature-flag gated.
//
// Architecture:
//   • Feature flag:  HUB_ENABLED=yes (off by default)
//   • API key:       CMC_HUB_API_KEY (or CMC_API_KEY as fallback)
//   • Transport:     Streamable HTTP, JSON-RPC 2.0, X-CMC-MCP-API-KEY header
//   • Session:       mcpInitialize() stores session ID for the process run
//   • Runner:        Injectable for tests — default uses real fetch, tests inject stubs
//
// If the Hub is unreachable or any call fails, callers receive null / empty
// HubSignals and fall back to REST automatically. This module never throws
// to its callers.
//
// SPOT-ONLY: never call get_global_crypto_derivatives_metrics.

import type { MarketSnapshot, HubSignals } from "@veydrift/shared";

// ── Constants ─────────────────────────────────────────────────────────────────

export const HUB_MCP_URL = "https://mcp.coinmarketcap.com/mcp";
const HUB_TIMEOUT_MS = 10_000;
const MCP_PROTOCOL_VERSION = "2024-11-05";

// CoinMarketCap numeric IDs for Keel's allowlisted tokens.
// Verified via live search_cryptos Hub lookup on 2026-06-19.
// get_crypto_quotes_latest requires { id } not { symbol } — wrong id = wrong price.
// SPOT-ONLY allowlist: ETH/CAKE/LINK (volatile) + USDT/USDC/USD1/FDUSD (stable).
export const CMC_HUB_ID: Record<string, number> = {
  ETH:   1027,   // Ethereum
  CAKE:  7186,   // PancakeSwap
  LINK:  1975,   // Chainlink
  USDT:  825,    // Tether USDt
  USDC:  3408,   // USDC
  USD1:  36148,  // World Liberty Financial USD
  FDUSD: 26081,  // First Digital USD
};

// ── Runner type ───────────────────────────────────────────────────────────────

// Calls one MCP tool and resolves with the parsed result data.
// Tests inject stubs that return pre-canned objects.
// The default runner (makeDefaultRunner) handles the full MCP HTTP round-trip.
export type HubToolRunner = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

// ── Feature flag + API key ────────────────────────────────────────────────────

export function isHubEnabled(): boolean {
  return process.env["HUB_ENABLED"] === "yes";
}

function getHubApiKey(): string | undefined {
  return process.env["CMC_HUB_API_KEY"] ?? process.env["CMC_API_KEY"];
}

// ── MCP HTTP transport (low-level) ────────────────────────────────────────────

// Extract the usable data from a JSON-RPC 2.0 response.
// MCP tool results are wrapped as: { result: { content: [{ type:"text", text:"..." }] } }
// The text field is itself a JSON string holding the actual tool data.
// Falls back gracefully if the server omits the content wrapper.
function extractMcpResult(raw: unknown): unknown {
  const rpc = raw as {
    result?: unknown;
    error?: { message?: string };
  };
  if (rpc.error) {
    throw new Error(`MCP error: ${rpc.error.message ?? JSON.stringify(rpc.error)}`);
  }
  const result = rpc.result as {
    content?: Array<{ type?: string; text?: string }>;
  } | undefined;
  const firstContent = result?.content?.[0];
  if (firstContent?.type === "text" && firstContent.text) {
    try {
      return JSON.parse(firstContent.text) as unknown;
    } catch {
      return firstContent.text;
    }
  }
  // No content wrapper — return result directly
  return rpc.result;
}

// Parse a streamed SSE response: look for the first usable "data:" event.
async function parseSSEResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      return extractMcpResult(JSON.parse(line.slice(6)));
    } catch {
      continue;
    }
  }
  throw new Error("Hub: no usable event in SSE stream");
}

// Make one MCP tools/call HTTP request.
async function httpToolCall(
  toolName: string,
  args: Record<string, unknown>,
  apiKey: string,
  sessionId: string | undefined,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HUB_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "X-CMC-MCP-API-KEY": apiKey,
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    const res = await fetch(HUB_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Hub HTTP ${res.status}: ${res.statusText}`);

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) return parseSSEResponse(res);
    return extractMcpResult(await res.json() as unknown);
  } finally {
    clearTimeout(timer);
  }
}

// Perform the MCP initialize handshake. Returns the session ID from the
// Mcp-Session-Id response header, or undefined for stateless servers.
async function mcpInitialize(apiKey: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HUB_TIMEOUT_MS);
  try {
    const res = await fetch(HUB_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "X-CMC-MCP-API-KEY": apiKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "keel-agent", version: "0.5.0" },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Hub init HTTP ${res.status}: ${res.statusText}`);
    return res.headers.get("Mcp-Session-Id") ?? undefined;
  } finally {
    clearTimeout(timer);
  }
}

// ── Session state (process-scoped) ────────────────────────────────────────────

let _sessionId: string | undefined;

// Build the default runner using the current session ID.
// Called once per fetchHubSnapshot / fetchHubEnrichment invocation.
function makeDefaultRunner(): HubToolRunner {
  return async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    const key = getHubApiKey();
    if (!key) throw new Error("Hub API key not configured (set CMC_HUB_API_KEY or CMC_API_KEY)");
    return httpToolCall(toolName, args, key, _sessionId);
  };
}

// ── Startup self-check ────────────────────────────────────────────────────────

// Returns true when the Hub is reachable and the API key is valid.
// Stores the session ID for subsequent calls in this process run.
// When an injected runner is provided (test mode), skips the network check.
export async function checkHubConnectivity(
  runner?: HubToolRunner,
): Promise<boolean> {
  if (!isHubEnabled()) return false;
  if (runner) return true; // injected runner = treat as connected in tests
  const key = getHubApiKey();
  if (!key) {
    console.warn("[veydrift hub] disabled — Hub API key not set");
    return false;
  }
  try {
    _sessionId = await mcpInitialize(key);
    return true;
  } catch (err) {
    console.warn(`[veydrift hub] unreachable — running on REST only. ${String(err)}`);
    return false;
  }
}

// ── Hub price snapshot ────────────────────────────────────────────────────────

// Extract price / 1h / 24h data from a get_crypto_quotes_latest result.
//
// The Hub MCP tool returns a flat array of quote objects:
//   [{ id:"1027", symbol:"ETH", price:1704.29, percent_change_1h:0.14, percent_change_24h:1.23, ... }]
//
// The CMC REST API (not used here) wraps in { data: { [symbol]: { quote: { USD: { price } } } } }.
// Both shapes are handled for defensive breadth.
function extractQuoteUsd(
  raw: unknown,
  symbol: string,
  id?: number,
): { price: number; change1h: number; change24h: number } | null {
  // Hub MCP: flat array of quote objects (primary path)
  if (Array.isArray(raw)) {
    const entry = raw.find((e: unknown) => {
      const item = e as { id?: string | number; symbol?: string };
      return item.symbol === symbol || (id != null && String(item.id) === String(id));
    }) as { price?: number; percent_change_1h?: number; percent_change_24h?: number } | undefined;
    if (entry == null || typeof entry.price !== "number") return null;
    return {
      price: entry.price,
      change1h: entry.percent_change_1h ?? 0,
      change24h: entry.percent_change_24h ?? 0,
    };
  }

  // Fallback: { data: { [key]: { quote: { USD: { price } } } } } shape
  const obj = raw as {
    data?: Record<string, {
      quote?: {
        USD?: {
          price?: number;
          percent_change_1h?: number;
          percent_change_24h?: number;
        };
      };
    }>;
  };
  const usd =
    obj?.data?.[symbol]?.quote?.USD ??
    (id != null ? obj?.data?.[String(id)]?.quote?.USD : undefined);
  if (typeof usd?.price !== "number") return null;
  return {
    price: usd.price,
    change1h: usd.percent_change_1h ?? 0,
    change24h: usd.percent_change_24h ?? 0,
  };
}

// Fetch price/1h/24h from the Hub via get_crypto_quotes_latest.
// Returns null on any error — caller MUST fall back to REST.
// Note: fearGreed is set to 0 because the Hub does not provide it;
// the caller (signals.ts) merges REST's fearGreed value.
// onError is called with the error string when the call fails, allowing the
// caller to record the error without changing the null-on-failure contract.
export async function fetchHubSnapshot(
  symbol: string,
  runner: HubToolRunner = makeDefaultRunner(),
  onError?: (err: string) => void,
): Promise<MarketSnapshot | null> {
  // Fail closed: unknown symbols get no Hub price rather than querying with a wrong id.
  const id = CMC_HUB_ID[symbol];
  if (id == null) {
    const msg = `${symbol} not in CMC Hub ID map — falling back to REST`;
    console.warn(`[veydrift hub] price fetch skipped: ${msg}`);
    if (onError) onError(msg);
    return null;
  }

  const t0 = Date.now();
  console.log(`[veydrift hub] price fetch · get_crypto_quotes_latest (${symbol} id=${id})`);
  try {
    const raw = await runner("get_crypto_quotes_latest", { id });
    if (process.env["HUB_DEBUG"] === "yes") {
      console.log("[veydrift hub] raw price response:", JSON.stringify(raw).slice(0, 500));
    }
    const q = extractQuoteUsd(raw, symbol, id);
    if (!q) {
      const msg = `null price in response for ${symbol} (id=${id})`;
      console.warn(`[veydrift hub] price fetch failed: ${msg} — falling back to REST`);
      if (onError) onError(msg);
      return null;
    }
    console.log(
      `[veydrift hub] price ok · ${symbol}=$${q.price.toFixed(2)} ` +
      `1h=${q.change1h.toFixed(2)}% 24h=${q.change24h.toFixed(2)}% · ${Date.now() - t0}ms`,
    );
    return {
      symbol,
      price: q.price,
      change1h: q.change1h,
      change24h: q.change24h,
      fearGreed: 0, // merged from REST by the caller
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    const msg = String(err);
    console.warn(`[veydrift hub] price fetch failed: ${msg} — falling back to REST`);
    if (onError) onError(msg);
    return null;
  }
}

// ── Hub enrichment signals ────────────────────────────────────────────────────

// Extract RSI from get_crypto_technical_analysis result.
//
// Hub MCP actual response shape (verified 2026-06-19):
//   { rsi: { rsi7: "43.42", rsi14: "38.81", rsi21: "37.91" }, ... }
// RSI values are strings — use rsi14 (14-day) as the primary signal.
function extractRsi(raw: unknown): number | undefined {
  // Hub MCP shape
  const hub = raw as { rsi?: { rsi14?: unknown } };
  if (hub?.rsi?.rsi14 != null) {
    const n = parseFloat(String(hub.rsi.rsi14));
    return isNaN(n) ? undefined : n;
  }
  // Defensive fallbacks for older/alternative shapes
  const obj = raw as {
    data?: {
      rsi?: number;
      technical_analysis?: { rsi?: number };
      indicators?: { rsi?: number };
    };
  };
  const d = obj?.data;
  return d?.rsi ?? d?.technical_analysis?.rsi ?? d?.indicators?.rsi;
}

// Extract hours until the next upcoming macro event.
//
// Hub MCP actual response shape (verified 2026-06-19):
//   { upcomingEventNews: { rows: [[title, content, url, eventDate, originalContent], ...] } }
// eventDate (index 3) is a human-readable string like "2 August 2026".
// All returned events are treated as macro-relevant (the tool already pre-filters).
function extractHoursToNextEvent(raw: unknown): number | undefined {
  // Hub MCP shape
  const hub = raw as { upcomingEventNews?: { rows?: Array<unknown[]> } };
  const rows = hub?.upcomingEventNews?.rows;
  if (Array.isArray(rows) && rows.length > 0) {
    const now = Date.now();
    const hours = rows
      .map((row) => {
        const dateStr = typeof row[3] === "string" ? row[3] : undefined;
        if (!dateStr) return Infinity;
        const t = new Date(dateStr).getTime();
        return isNaN(t) ? Infinity : (t - now) / 3_600_000;
      })
      .filter((h) => h > 0 && h !== Infinity)
      .sort((a, b) => a - b);
    return hours[0];
  }
  // Defensive fallback for older shape: { data: Array<{ date, impact }> }
  const obj = raw as { data?: Array<{ date?: string; impact?: string }> };
  const events = obj?.data;
  if (!Array.isArray(events) || events.length === 0) return undefined;
  const now = Date.now();
  const upcoming = events
    .filter(e => {
      const imp = (e.impact ?? "").toLowerCase();
      return imp === "high" || imp === "3";
    })
    .map(e => {
      const t = e.date ? new Date(e.date).getTime() : NaN;
      return isNaN(t) ? Infinity : (t - now) / 3_600_000;
    })
    .filter(h => h > 0)
    .sort((a, b) => a - b);
  return upcoming[0];
}

// Extract BTC dominance % from get_global_metrics_latest result.
//
// Hub MCP actual response shape (verified 2026-06-19):
//   { dominance: { btc: { current: "+58.35%" } }, ... }
// Dominance is a string with sign and % — strip and parse.
function extractBtcDominance(raw: unknown): number | undefined {
  // Hub MCP shape
  const hub = raw as { dominance?: { btc?: { current?: unknown } } };
  const pctStr = hub?.dominance?.btc?.current;
  if (typeof pctStr === "string") {
    const n = parseFloat(pctStr.replace(/[+%]/g, ""));
    return isNaN(n) ? undefined : n;
  }
  // Defensive fallback for older shape: { data: { btc_dominance } }
  const obj = raw as { data?: { btc_dominance?: number; btc_market_cap_dominance?: number } };
  return obj?.data?.btc_dominance ?? obj?.data?.btc_market_cap_dominance;
}

// Fetch Hub enrichment signals for the overlay stack.
// Calls three tools in parallel; each failure is logged and skipped.
// Always resolves — never throws. Returns a (possibly empty) HubSignals.
// onToolResult is called per tool with "ok" or the error message, allowing
// callers to build a per-cycle observability record.
export async function fetchHubEnrichment(
  symbol: string,
  runner: HubToolRunner = makeDefaultRunner(),
  onToolResult?: (tool: "ta" | "macro" | "btcDom", status: "ok" | string) => void,
): Promise<HubSignals> {
  const signals: HubSignals = {};

  // get_crypto_technical_analysis requires { id: "<numeric-id>" } — NOT { symbol }
  const taId = CMC_HUB_ID[symbol];

  await Promise.allSettled([
    (taId == null
      ? Promise.reject(new Error(`${symbol} not in CMC Hub ID map`))
      : runner("get_crypto_technical_analysis", { id: String(taId) })
    )
      .then(raw => {
        if (process.env["HUB_DEBUG"] === "yes") {
          console.log("[veydrift hub] raw ta response:", JSON.stringify(raw).slice(0, 500));
        }
        signals.rsi = extractRsi(raw);
        const rsiLabel = signals.rsi != null ? signals.rsi.toFixed(1) : "no data available";
        console.log(`[veydrift hub] ta ok · RSI=${rsiLabel}`);
        if (onToolResult) onToolResult("ta", "ok");
      })
      .catch((err: unknown) => {
        const msg = String(err);
        console.warn(`[veydrift hub] ta failed: ${msg} — TA-caution overlay skipped this cycle`);
        if (onToolResult) onToolResult("ta", msg);
      }),

    runner("get_upcoming_macro_events", {})
      .then(raw => {
        if (process.env["HUB_DEBUG"] === "yes") {
          console.log("[veydrift hub] raw macro response:", JSON.stringify(raw).slice(0, 500));
        }
        signals.hoursToNextMacroEvent = extractHoursToNextEvent(raw);
        const h = signals.hoursToNextMacroEvent;
        const macroLabel = h != null ? `${h.toFixed(1)}h` : "no data available";
        console.log(`[veydrift hub] macro ok · next event in ${macroLabel}`);
        if (onToolResult) onToolResult("macro", "ok");
      })
      .catch((err: unknown) => {
        const msg = String(err);
        console.warn(`[veydrift hub] macro failed: ${msg} — macro-event overlay skipped this cycle`);
        if (onToolResult) onToolResult("macro", msg);
      }),

    runner("get_global_metrics_latest", {})
      .then(raw => {
        if (process.env["HUB_DEBUG"] === "yes") {
          console.log("[veydrift hub] raw btcDom response:", JSON.stringify(raw).slice(0, 500));
        }
        signals.btcDominancePct = extractBtcDominance(raw);
        const domLabel = signals.btcDominancePct != null
          ? `${signals.btcDominancePct.toFixed(1)}%`
          : "no data available";
        console.log(`[veydrift hub] btcDom ok · BTC dominance=${domLabel}`);
        if (onToolResult) onToolResult("btcDom", "ok");
      })
      .catch((err: unknown) => {
        const msg = String(err);
        console.warn(`[veydrift hub] btcDom failed: ${msg} — regime-bias overlay skipped this cycle`);
        if (onToolResult) onToolResult("btcDom", msg);
      }),
  ]);

  return signals;
}
