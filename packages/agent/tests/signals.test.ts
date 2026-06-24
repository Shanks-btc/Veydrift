import { describe, it, expect } from "vitest";
import { fetchSignals, type RestFetcher } from "../src/perception/signals.js";
import type { HubToolRunner } from "../src/perception/hub.js";
import type { MarketSnapshot } from "@veydrift/shared";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Stub REST snapshot — always succeeds
const stubRestSnapshot: MarketSnapshot = {
  symbol: "ETH",
  price: 3_400,
  change1h: 0.3,
  change24h: 1.8,
  fearGreed: 42,
  fetchedAt: "2026-06-19T00:00:00.000Z",
};

const stubRestFetcher: RestFetcher = async () => ({ ...stubRestSnapshot });

// Stub Hub runner returning a slightly different price to distinguish Hub vs REST
const stubHubRunner: HubToolRunner = async (toolName: string) => {
  switch (toolName) {
    case "get_crypto_quotes_latest":
      return {
        data: {
          ETH: {
            quote: {
              USD: { price: 3_600, percent_change_1h: 0.7, percent_change_24h: 2.5 },
            },
          },
        },
      };
    case "get_crypto_technical_analysis":
      return { data: { rsi: 72.1 } };
    case "get_upcoming_macro_events":
      return {
        data: [
          {
            date: new Date(Date.now() + 10 * 3_600_000).toISOString(),
            impact: "High",
            title: "FOMC",
          },
        ],
      };
    case "get_global_metrics_latest":
      return { data: { btc_dominance: 56.8 } };
    default:
      throw new Error(`Unexpected tool: ${toolName}`);
  }
};

// Hub runner that throws on price but succeeds on enrichment
const hubPriceFailRunner: HubToolRunner = async (toolName: string) => {
  if (toolName === "get_crypto_quotes_latest") throw new Error("Hub price unavailable");
  return stubHubRunner(toolName, {});
};

// Hub runner that always throws
const hubAlwaysFailRunner: HubToolRunner = async () => {
  throw new Error("Hub completely down");
};

// ── REST-only mode (HUB_ENABLED not set) ─────────────────────────────────────

describe("fetchSignals — REST only (HUB_ENABLED not set)", () => {
  it("returns the REST snapshot and priceSource=rest", async () => {
    await withEnv({ HUB_ENABLED: undefined }, async () => {
      const result = await fetchSignals("ETH", undefined, stubRestFetcher);
      expect(result.priceSource).toBe("rest");
      expect(result.snapshot.price).toBe(stubRestSnapshot.price);
      expect(result.snapshot.fearGreed).toBe(42);
    });
  });

  it("returns empty hub signals when Hub is disabled", async () => {
    await withEnv({ HUB_ENABLED: undefined }, async () => {
      const result = await fetchSignals("ETH", undefined, stubRestFetcher);
      expect(result.hub).toEqual({});
    });
  });

  it("hubConnected=false when Hub is disabled", async () => {
    await withEnv({ HUB_ENABLED: undefined }, async () => {
      const result = await fetchSignals("ETH", undefined, stubRestFetcher);
      expect(result.hubConnected).toBe(false);
    });
  });
});

// ── Hub enabled, Hub succeeds ─────────────────────────────────────────────────

describe("fetchSignals — Hub enabled, Hub succeeds", () => {
  it("uses Hub price/1h/24h when Hub responds successfully", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", stubHubRunner, stubRestFetcher);
      expect(result.priceSource).toBe("hub");
      expect(result.snapshot.price).toBe(3_600); // Hub price, not REST 3400
      expect(result.snapshot.change1h).toBe(0.7);
      expect(result.snapshot.change24h).toBe(2.5);
    });
  });

  it("always uses REST fearGreed even when Hub provides the price", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", stubHubRunner, stubRestFetcher);
      expect(result.snapshot.fearGreed).toBe(42); // from REST, never from Hub
    });
  });

  it("hubConnected=true when Hub price fetch succeeds", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", stubHubRunner, stubRestFetcher);
      expect(result.hubConnected).toBe(true);
    });
  });

  it("populates Hub enrichment signals from all three tools", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", stubHubRunner, stubRestFetcher);
      expect(typeof result.hub.rsi).toBe("number");
      expect(typeof result.hub.hoursToNextMacroEvent).toBe("number");
      expect(typeof result.hub.btcDominancePct).toBe("number");
    });
  });
});

// ── Hub enabled, Hub price fails → REST fallback ──────────────────────────────

describe("fetchSignals — Hub enabled, Hub price fails → REST fallback", () => {
  it("falls back to REST price when Hub price fetch fails", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", hubPriceFailRunner, stubRestFetcher);
      expect(result.priceSource).toBe("rest");
      expect(result.snapshot.price).toBe(stubRestSnapshot.price);
    });
  });

  it("hubConnected=false when Hub price fetch fails", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", hubPriceFailRunner, stubRestFetcher);
      expect(result.hubConnected).toBe(false);
    });
  });

  it("still returns REST snapshot with correct fearGreed when Hub fails", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", hubPriceFailRunner, stubRestFetcher);
      expect(result.snapshot.fearGreed).toBe(42);
    });
  });
});

// ── Hub completely down ───────────────────────────────────────────────────────

describe("fetchSignals — Hub completely down", () => {
  it("returns REST snapshot with priceSource=rest when Hub always throws", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", hubAlwaysFailRunner, stubRestFetcher);
      expect(result.priceSource).toBe("rest");
      expect(result.snapshot.price).toBe(stubRestSnapshot.price);
    });
  });

  it("returns empty hub signals when Hub is completely down", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", hubAlwaysFailRunner, stubRestFetcher);
      expect(result.hub).toEqual({});
    });
  });

  it("hubConnected=false when Hub is completely down", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", hubAlwaysFailRunner, stubRestFetcher);
      expect(result.hubConnected).toBe(false);
    });
  });

  it("REST is always called — decision loop works on REST alone", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      let restCalled = false;
      const trackingFetcher: RestFetcher = async () => {
        restCalled = true;
        return { ...stubRestSnapshot };
      };
      await fetchSignals("ETH", hubAlwaysFailRunner, trackingFetcher);
      expect(restCalled).toBe(true);
    });
  });
});

// ── Structural invariants ─────────────────────────────────────────────────────

describe("fetchSignals — invariants", () => {
  it("REST fetcher is always called regardless of Hub status", async () => {
    let restCallCount = 0;
    const countingFetcher: RestFetcher = async () => {
      restCallCount++;
      return { ...stubRestSnapshot };
    };

    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      await fetchSignals("ETH", stubHubRunner, countingFetcher);
    });
    expect(restCallCount).toBe(1);

    restCallCount = 0;
    await withEnv({ HUB_ENABLED: undefined }, async () => {
      await fetchSignals("ETH", undefined, countingFetcher);
    });
    expect(restCallCount).toBe(1);
  });

  it("snapshot always contains a valid fetchedAt string", async () => {
    await withEnv({ HUB_ENABLED: "yes" }, async () => {
      const result = await fetchSignals("ETH", stubHubRunner, stubRestFetcher);
      expect(typeof result.snapshot.fetchedAt).toBe("string");
      expect(result.snapshot.fetchedAt.length).toBeGreaterThan(0);
    });
  });

  it("hub field is always an object (never null or undefined)", async () => {
    for (const [name, runner] of [
      ["disabled", undefined] as const,
      ["down", hubAlwaysFailRunner] as const,
    ]) {
      const enabled = name === "down" ? "yes" : undefined;
      await withEnv({ HUB_ENABLED: enabled }, async () => {
        const result = await fetchSignals("ETH", runner, stubRestFetcher);
        expect(result.hub).toBeDefined();
        expect(typeof result.hub).toBe("object");
      });
    }
  });
});
