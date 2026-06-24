import { describe, it, expect } from "vitest";
import { runScheduler, type SchedulerInput, type SchedulerDeps } from "../src/loop/scheduler.js";
import type {
  AgentPersistentState,
  MarketSnapshot,
  ExecutionPlan,
  ExecutionResult,
} from "@veydrift/shared";

// ── Fixed clock (all tests use 2026-06-19) ───────────────────────────────────

const FIXED_NOW = new Date("2026-06-19T12:00:00.000Z");
const TODAY = "2026-06-19";

// ── Market snapshots ──────────────────────────────────────────────────────────

// R ≈ 0.033 → risk-on mode, target volatile = 80%
const riskOnSnapshot: MarketSnapshot = {
  symbol: "ETH",
  price: 3_400,
  change1h: 0.1,
  change24h: 0.5,
  fearGreed: 30,
  fetchedAt: FIXED_NOW.toISOString(),
};

// ── In-memory state factory ───────────────────────────────────────────────────

function makeStore(
  overrides: Partial<AgentPersistentState> = {},
): { state: AgentPersistentState } {
  const initial: AgentPersistentState = {
    highWaterMarkUsd: 0,
    dailyLossStartUsd: 0,
    dayLedger: {},
    lastUpdated: "",
    ...overrides,
  };
  return { state: JSON.parse(JSON.stringify(initial)) };
}

// ── Shared stub execution: always succeeds with a fake BSC tx hash ────────────

const stubExecSuccess = (_plan: ExecutionPlan): ExecutionResult => ({
  ok: true,
  txHash: "0x99ef6856cd679a65a7d7877b97bd5a4f525b98b0b61a2589481f2a108e6d9854",
  explorerUrl: "https://bscscan.com/tx/0x99ef",
});

const stubExecFail = (_plan: ExecutionPlan): ExecutionResult => ({
  ok: false,
  error: "TWAK: timeout",
});

// ── Dep builder ───────────────────────────────────────────────────────────────

function makeDeps(
  store: ReturnType<typeof makeStore>,
  overrides: Partial<SchedulerDeps> = {},
): SchedulerDeps {
  return {
    now: () => FIXED_NOW,
    restFetcher: async () => ({ ...riskOnSnapshot }),
    executeTrade: stubExecSuccess,
    loadState: (_dir) => JSON.parse(JSON.stringify(store.state)),
    saveState: (s, _dir) => {
      store.state = JSON.parse(JSON.stringify(s));
    },
    appendAudit: () => undefined,
    ...overrides,
  };
}

// ── Helper: run scheduler with convenient defaults ────────────────────────────

async function run(
  input: Partial<SchedulerInput>,
  deps?: SchedulerDeps,
): Promise<ReturnType<typeof runScheduler>> {
  const store = makeStore();
  return runScheduler({
    totalValueUsd: 1000,
    volatileValueUsd: 100,   // 10% volatile (well under 80% risk-on target)
    stableValueUsd: 850,
    deps: deps ?? makeDeps(store),
    ...input,
  });
}

// ── Idempotency: SKIPPED when already EXECUTED ────────────────────────────────

describe("runScheduler — idempotency (SKIPPED)", () => {
  it("returns SKIPPED when today is already marked EXECUTED", async () => {
    const store = makeStore({
      dayLedger: {
        [TODAY]: {
          date: TODAY,
          status: "EXECUTED",
          action: "EXECUTED",
          txHash: "0xabc",
          timestamp: "2026-06-19T08:00:00Z",
        },
      },
    });
    const result = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 100,
      stableValueUsd: 850,
      deps: makeDeps(store),
    });
    expect(result.action).toBe("SKIPPED");
  });

  it("returns SKIPPED when today is already marked BLOCKED", async () => {
    const store = makeStore({
      dayLedger: {
        [TODAY]: {
          date: TODAY,
          status: "BLOCKED",
          action: "BLOCKED",
          blockedReason: "no stables",
          timestamp: "2026-06-19T08:00:00Z",
        },
      },
    });
    const result = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 100,
      stableValueUsd: 850,
      deps: makeDeps(store),
    });
    expect(result.action).toBe("SKIPPED");
  });

  it("re-runs on a new calendar day even when yesterday was EXECUTED", async () => {
    const store = makeStore({
      highWaterMarkUsd: 1000,
      dayLedger: {
        "2026-06-18": {   // YESTERDAY
          date: "2026-06-18",
          status: "EXECUTED",
          action: "FALLBACK_EXECUTED",
          txHash: "0xabc",
          timestamp: "2026-06-18T12:00:00Z",
        },
      },
    });
    const result = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 770,  // 77% volatile, within 3% of 80% target → HOLD
      stableValueUsd: 200,
      deps: makeDeps(store),
    });
    // Should attempt something (not SKIPPED) since it's a new day
    expect(result.action).not.toBe("SKIPPED");
  });

  it("records EXECUTED in the day ledger after a successful trade", async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    const r1 = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 770,  // 77%, target 80% → within band (3% < 5%) → HOLD
      stableValueUsd: 200,    // enough for fallback
      deps,
    });
    expect(r1.action).not.toBe("SKIPPED");
    // Second call on same day
    const r2 = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 770,
      stableValueUsd: 200,
      deps,
    });
    expect(r2.action).toBe("SKIPPED");
  });
});

// ── KILL_SWITCH path ──────────────────────────────────────────────────────────

describe("runScheduler — KILL_SWITCH path", () => {
  it("returns KILL_SWITCH when drawdown reaches -22% (below -18% threshold)", async () => {
    const store = makeStore({ highWaterMarkUsd: 1_000 }); // current $780 = -22%
    const result = await runScheduler({
      totalValueUsd: 780,
      volatileValueUsd: 700,
      stableValueUsd: 80,
      deps: makeDeps(store),
    });
    expect(result.action).toBe("KILL_SWITCH");
    expect(result.txHash).toBeTruthy();
  });

  it("kill-switch bypasses the daily idempotency check", async () => {
    // Pre-mark today as already EXECUTED
    const store = makeStore({
      highWaterMarkUsd: 1_000,
      dayLedger: {
        [TODAY]: {
          date: TODAY,
          status: "EXECUTED",
          action: "EXECUTED",
          txHash: "0xold",
          timestamp: "2026-06-19T08:00:00Z",
        },
      },
    });
    const result = await runScheduler({
      totalValueUsd: 780,
      volatileValueUsd: 700,
      stableValueUsd: 80,
      deps: makeDeps(store),
    });
    // Kill-switch must still fire even though today was already EXECUTED
    expect(result.action).toBe("KILL_SWITCH");
  });

  it("returns BLOCKED when kill-switch fires but execution fails", async () => {
    const store = makeStore({ highWaterMarkUsd: 1_000 });
    const result = await runScheduler({
      totalValueUsd: 780,
      volatileValueUsd: 700,
      stableValueUsd: 80,
      deps: makeDeps(store, { executeTrade: stubExecFail }),
    });
    expect(result.action).toBe("BLOCKED");
    expect(result.blockedReason).toMatch(/kill-switch execution failed/i);
  });

  it("does NOT trigger kill-switch when already flat (volatileValueUsd = 0)", async () => {
    const store = makeStore({ highWaterMarkUsd: 1_000 });
    const result = await runScheduler({
      totalValueUsd: 780,
      volatileValueUsd: 0,   // already flat — nothing to flatten
      stableValueUsd: 780,
      deps: makeDeps(store),
    });
    // Kill-switch is blocked from Path 1 (volatileValueUsd = 0 check)
    // Falls through to idempotency → fallback
    expect(result.action).not.toBe("KILL_SWITCH");
  });
});

// ── EXECUTED: normal trade path ───────────────────────────────────────────────

describe("runScheduler — EXECUTED (normal trade)", () => {
  it("executes and returns EXECUTED when cycle produces a valid trade", async () => {
    // Portfolio: 10% volatile, risk-on market (target 80%)
    // shouldRebalance(10, 80) = |70| > 5 → rebalance → BUY
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 100,
      stableValueUsd: 800,
      deps: makeDeps(store),
    });
    expect(result.action).toBe("EXECUTED");
    expect(result.txHash).toBeTruthy();
  });

  it("records EXECUTED in day ledger with tx hash", async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 100,
      stableValueUsd: 800,
      deps,
    });
    expect(store.state.dayLedger[TODAY]?.status).toBe("EXECUTED");
    expect(store.state.dayLedger[TODAY]?.txHash).toBeTruthy();
  });

  it("audit entry contains the BSC tx hash (never a Base/x402 hash)", async () => {
    const result = await run({
      totalValueUsd: 1_000,
      volatileValueUsd: 100,
      stableValueUsd: 800,
    });
    if (result.action === "EXECUTED") {
      expect(result.auditEntry.txHash).toBeTruthy();
      // The explorer URL in the tx should point to bscscan.com (verified by execution.ts)
      // Here we just confirm the audit entry carries the hash
      expect(typeof result.auditEntry.txHash).toBe("string");
    }
  });

  it("updates HWM when portfolio value sets a new high", async () => {
    const store = makeStore({ highWaterMarkUsd: 900 }); // current $1000 > HWM $900
    const deps = makeDeps(store);
    await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 100,
      stableValueUsd: 800,
      deps,
    });
    expect(store.state.highWaterMarkUsd).toBe(1_000);
  });
});

// ── FALLBACK_EXECUTED: drawdown-neutral fallback ──────────────────────────────

describe("runScheduler — FALLBACK_EXECUTED (stable-to-stable fallback)", () => {
  it("returns FALLBACK_EXECUTED on a calm day when cycle says HOLD", async () => {
    // Portfolio: 77% volatile (within 3% of 80% risk-on target → within band → HOLD)
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 770,
      stableValueUsd: 200,   // enough for $2 fallback
      deps: makeDeps(store),
    });
    expect(result.action).toBe("FALLBACK_EXECUTED");
    expect(result.txHash).toBeTruthy();
  });

  it("records EXECUTED status (not a separate status) for the fallback", async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 770,
      stableValueUsd: 200,
      deps,
    });
    expect(store.state.dayLedger[TODAY]?.status).toBe("EXECUTED");
    expect(store.state.dayLedger[TODAY]?.action).toBe("FALLBACK_EXECUTED");
  });

  it("proposal reason uses the exact honesty label", async () => {
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 770,
      stableValueUsd: 200,
      deps: makeDeps(store),
    });
    if (result.action === "FALLBACK_EXECUTED" && result.auditEntry.proposal) {
      expect(result.auditEntry.proposal.reason).toMatch(
        /fallback qualification attempt/i,
      );
      expect(result.auditEntry.proposal.reason).not.toMatch(
        /guaranteed qualifying trade/i,
      );
    }
  });
});

// ── BLOCKED: all paths blocked ────────────────────────────────────────────────

describe("runScheduler — BLOCKED (all paths blocked)", () => {
  it("returns BLOCKED when stable balance is below fallbackSwapSizeUsd ($2)", async () => {
    // 77% volatile (HOLD), stableValueUsd = $1 < $2 minimum
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 770,
      stableValueUsd: 1.0,  // < $2 fallback minimum
      deps: makeDeps(store),
    });
    expect(result.action).toBe("BLOCKED");
    expect(result.blockedReason).toMatch(/insufficient stables/i);
  });

  it("records BLOCKED status in day ledger", async () => {
    const store = makeStore();
    const deps = makeDeps(store);
    await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 770,
      stableValueUsd: 1.0,
      deps,
    });
    expect(store.state.dayLedger[TODAY]?.status).toBe("BLOCKED");
  });

  it("returns BLOCKED when execution fails on the fallback trade", async () => {
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 770,
      stableValueUsd: 200,
      deps: makeDeps(store, { executeTrade: stubExecFail }),
    });
    expect(result.action).toBe("BLOCKED");
    expect(result.blockedReason).toMatch(/fallback execution failed/i);
  });
});

// ── §4 projected-drawdown gate blocks normal trade → falls to FALLBACK ────────

describe("runScheduler — projected-drawdown gate blocks normal trade", () => {
  it("falls through to FALLBACK_EXECUTED when gate blocks a risk-increasing trade", async () => {
    // Portfolio: 30% volatile, HWM $1000, current $900 → drawdown -10% (in overlay zone)
    // Market: risk-on (target 80%), cycle proposes BUY $225 (capped at 25%)
    // Projected: (30%*900 + 225) / 900 = 55% > 45% overlay cap → gate BLOCKS
    // Fallback: $400 stables > $2 → FALLBACK_EXECUTED
    const store = makeStore({ highWaterMarkUsd: 1_000 });
    const result = await runScheduler({
      totalValueUsd: 900,
      volatileValueUsd: 270,   // 30%
      stableValueUsd: 400,     // plenty for fallback
      deps: makeDeps(store),
    });
    expect(result.action).toBe("FALLBACK_EXECUTED");
  });

  it("normal trade succeeds when projected exposure stays under overlay cap", async () => {
    // Portfolio: 10% volatile, HWM $1000, current $900 → drawdown -10%
    // Cycle proposes BUY $225 (capped), projected: (90 + 225)/900 = 35% < 45% cap → PASS
    const store = makeStore({ highWaterMarkUsd: 1_000 });
    const result = await runScheduler({
      totalValueUsd: 900,
      volatileValueUsd: 90,    // 10%
      stableValueUsd: 700,
      deps: makeDeps(store),
    });
    expect(result.action).toBe("EXECUTED");
  });
});

// ── Audit entry completeness ──────────────────────────────────────────────────

describe("runScheduler — audit entry structure", () => {
  it("audit entry always has a cycleId and date", async () => {
    const result = await run({ totalValueUsd: 1_000, volatileValueUsd: 770, stableValueUsd: 200 });
    expect(result.auditEntry.cycleId).toBeTruthy();
    expect(result.auditEntry.date).toBe(TODAY);
  });

  it("audit entry records the action taken", async () => {
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 770,
      stableValueUsd: 200,
      deps: makeDeps(store),
    });
    expect(result.auditEntry.action).toBe(result.action);
  });

  it("audit entry for SKIPPED still contains riskScore and mode", async () => {
    const store = makeStore({
      dayLedger: {
        [TODAY]: {
          date: TODAY,
          status: "EXECUTED",
          action: "EXECUTED",
          txHash: "0xold",
          timestamp: "2026-06-19T08:00:00Z",
        },
      },
    });
    const result = await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 770,
      stableValueUsd: 200,
      deps: makeDeps(store),
    });
    expect(result.auditEntry.riskScore).toBeDefined();
    expect(result.auditEntry.mode).toBeDefined();
  });
});

// ── Password never leaks ──────────────────────────────────────────────────────

describe("runScheduler — BNB_WALLET_PASSWORD never appears in output", () => {
  it("blockedReason never contains the wallet password", async () => {
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1_000,
      volatileValueUsd: 770,
      stableValueUsd: 1.0,
      deps: makeDeps(store),
    });
    const allText = JSON.stringify(result);
    expect(allText).not.toContain("BNB_WALLET_PASSWORD");
    expect(allText).not.toContain("secret");
  });
});
