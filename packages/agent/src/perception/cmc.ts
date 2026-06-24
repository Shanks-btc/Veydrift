// CMC perception — read-only. No execution, no funds.
// Endpoints confirmed in docs/verify-in-docs.md §1, §3, §4.
// Mirrors the verified fetch pattern in keel.cjs perceive().

import type { MarketSnapshot } from "@veydrift/shared";

const BASE = "https://pro-api.coinmarketcap.com";

export class CmcError extends Error {
  constructor(
    message: string,
    public readonly context?: unknown,
  ) {
    super(message);
    this.name = "CmcError";
  }
}

// Fetch price, 1h change, 24h change, and Fear & Greed for a single symbol.
// apiKey is read from CMC_API_KEY env var when not supplied explicitly.
// Throws CmcError if the key is missing or CMC returns an error status.
export async function fetchMarketSnapshot(
  symbol: string = "ETH",
  apiKey: string = process.env["CMC_API_KEY"] ?? "",
): Promise<MarketSnapshot> {
  if (!apiKey) {
    throw new CmcError(
      "CMC_API_KEY is not set — set it in your environment before running the agent",
    );
  }

  const headers: Record<string, string> = { "X-CMC_PRO_API_KEY": apiKey };

  // ── Fetch price / 1h / 24h (confirmed endpoint from verify-in-docs.md §1, §4) ──
  const quoteUrl = `${BASE}/v1/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol)}`;
  const quoteRes = await fetch(quoteUrl, { headers });
  if (!quoteRes.ok) {
    throw new CmcError(`CMC quotes/latest returned HTTP ${quoteRes.status}`, {
      status: quoteRes.status,
      symbol,
    });
  }
  const quoteBody = (await quoteRes.json()) as Record<string, unknown>;
  const usd = (
    (quoteBody["data"] as Record<string, unknown>)?.[symbol] as
      | Record<string, unknown>
      | undefined
  )?.["quote"] as Record<string, unknown> | undefined;
  const usdQuote = usd?.["USD"] as Record<string, number> | undefined;

  if (!usdQuote) {
    throw new CmcError(
      `CMC response missing data[${symbol}].quote.USD — check the symbol or API tier`,
      quoteBody,
    );
  }

  const price: number = usdQuote["price"] ?? 0;
  const change1h: number = usdQuote["percent_change_1h"] ?? 0;
  const change24h: number = usdQuote["percent_change_24h"] ?? 0;

  // ── Fetch Fear & Greed (confirmed endpoint from verify-in-docs.md §3) ──────
  let fearGreed = 50; // neutral fallback if the endpoint fails
  try {
    const fgRes = await fetch(`${BASE}/v3/fear-and-greed/latest`, { headers });
    if (fgRes.ok) {
      const fgBody = (await fgRes.json()) as Record<string, unknown>;
      const raw = (fgBody["data"] as Record<string, unknown>)?.["value"];
      if (typeof raw === "number") fearGreed = raw;
    }
  } catch {
    // Non-fatal: proceed with neutral fallback (50)
  }

  return {
    symbol,
    price,
    change1h,
    change24h,
    fearGreed,
    fetchedAt: new Date().toISOString(),
  };
}
