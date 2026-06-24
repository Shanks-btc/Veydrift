// Signals aggregator — per-cycle fetch of market data.
//
// Strategy:
//   1. Always fetch the REST snapshot (reliable base; provides Fear & Greed).
//   2. If HUB_ENABLED=yes, attempt Hub for price/1h/24h (primary price source).
//      On any Hub failure, fall back to REST price silently within the same cycle.
//   3. If HUB_ENABLED=yes, fetch Hub enrichment signals in parallel with the
//      price fetch. Enrichment failures are logged and skipped (empty HubSignals).
//
// The decision loop is fully functional on REST alone. Hub is never on the
// critical path — the daily qualification attempt never depends on Hub being up.

import type { MarketSnapshot, HubSignals, HubAttempt, SignalsResult } from "@veydrift/shared";
import { fetchMarketSnapshot } from "./cmc.js";
import {
  isHubEnabled,
  fetchHubSnapshot,
  fetchHubEnrichment,
  type HubToolRunner,
} from "./hub.js";

// Injectable REST fetcher — default wraps fetchMarketSnapshot().
// Tests inject a stub to avoid live CMC REST calls.
export type RestFetcher = () => Promise<MarketSnapshot>;

const defaultRestFetcher: RestFetcher = () => fetchMarketSnapshot();

// Fetch all signals for one cycle.
// REST is always called; Hub is called only when HUB_ENABLED=yes.
// All Hub errors are caught internally — this function only rejects when
// the REST fetch itself fails.
export async function fetchSignals(
  symbol = "ETH",
  hubRunner?: HubToolRunner,
  restFetcher: RestFetcher = defaultRestFetcher,
): Promise<SignalsResult> {
  // REST is the reliable base — always fetched, provides Fear & Greed.
  const restSnapshot = await restFetcher();

  let snapshot: MarketSnapshot = restSnapshot;
  let priceSource: "hub" | "rest" = "rest";
  let hub: HubSignals = {};
  let hubConnected = false;
  let hubAttempt: HubAttempt | undefined;

  if (isHubEnabled()) {
    console.log(`[veydrift hub] attempting Hub price + enrichment for ${symbol}`);

    // Capture per-tool outcomes for the hubAttempt audit record.
    let priceError: string | undefined;
    let taStatus: string | undefined;
    let macroStatus: string | undefined;
    let btcDomStatus: string | undefined;

    // Run Hub price + enrichment fetches in parallel (credit-efficient: one bundle per cycle).
    const [priceResult, enrichResult] = await Promise.allSettled([
      fetchHubSnapshot(symbol, hubRunner, (err) => { priceError = err; }),
      fetchHubEnrichment(symbol, hubRunner, (tool, status) => {
        if (tool === "ta")     taStatus     = status;
        if (tool === "macro")  macroStatus  = status;
        if (tool === "btcDom") btcDomStatus = status;
      }),
    ]);

    // Hub price: override REST price/1h/24h when Hub responds successfully.
    // Keep REST's fearGreed regardless — Hub does not provide it.
    if (priceResult.status === "fulfilled" && priceResult.value !== null) {
      hubConnected = true;
      priceSource = "hub";
      snapshot = {
        ...restSnapshot,
        price: priceResult.value.price,
        change1h: priceResult.value.change1h,
        change24h: priceResult.value.change24h,
      };
    }

    // Hub enrichment: populate HubSignals for the overlay stack.
    if (enrichResult.status === "fulfilled") {
      hub = enrichResult.value;
    }

    // Build the per-cycle hubAttempt record for the audit log.
    const priceStatus =
      priceResult.status === "fulfilled" && priceResult.value !== null
        ? "ok"
        : (priceError ?? "null result");
    hubAttempt = {
      price:  priceStatus,
      ta:     taStatus     ?? "not-reached",
      macro:  macroStatus  ?? "not-reached",
      btcDom: btcDomStatus ?? "not-reached",
    };

    console.log(
      `[veydrift hub] cycle complete · connected=${hubConnected} priceSource=${priceSource} ` +
      `price=${hubAttempt.price} ta=${hubAttempt.ta} ` +
      `macro=${hubAttempt.macro} btcDom=${hubAttempt.btcDom}`,
    );
  }

  return { snapshot, hub, priceSource, hubConnected, hubAttempt };
}
