import { describe, it, expect } from "vitest";
import { runScheduler, type SchedulerDeps } from "../src/loop/scheduler.js";
import type {
  AgentPersistentState,
  MarketSnapshot,
  ExecutionPlan,
  ExecutionResult,
} from "@veydrift/shared";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStore(overrides: Partial<AgentPersistentState> = {}) {
  const initial: AgentPersistentState = {
    highWaterMarkUsd: 0,
    dailyLossStartUsd: 0,
    dayLedger: {},
    lastUpdated: "",
    ...overrides,
  };
  return { state: JSON.parse(JSON.stringify(initial)) as AgentPersistentState };
}

const FIXED_NOW = new Date("2026-06-19T12:00:00.000Z");
const TODAY = "2026-06-19";

const riskOnSnapshot: MarketSnapshot = {
  symbol: "ETH",
  price: 3_400,
  change1h: 0.1,
  change24h: 0.5,
  fearGreed: 30,
  fetchedAt: FIXED_NOW.toISOString(),
};

const stubExecSuccess = (_plan: ExecutionPlan): ExecutionResult => ({
  ok: true,
  txHash: "0x99ef6856cd679a65a7d7877b97bd5a4f525b98b0b61a2589481f2a108e6d9854",
  explorerUrl: "https://bscscan.com/tx/0x99ef",
});

const stubExecFail = (_plan: ExecutionPlan): ExecutionResult => ({
  ok: false,
  error: "TWAK: timeout",
});

function makeDeps(
  store: ReturnType<typeof makeStore>,
  overrides: Partial<SchedulerDeps> = {},
): SchedulerDeps {
  return {
    now: () => FIXED_NOW,
    restFetcher: async () => ({ ...riskOnSnapshot }),
    executeTrade: stubExecSuccess,
    loadState: (_dir) => JSON.parse(JSON.stringify(store.state)) as AgentPersistentState,
    saveState: (s, _dir) => {
      store.state = JSON.parse(JSON.stringify(s)) as AgentPersistentState;
    },
    appendAudit: () => undefined,
    ...overrides,
  };
}

// ── Pure deadline-status computation (mirrors SchedulerStatusCard.tsx logic) ─
// Tested here so both the field mutation (scheduler) and the badge derivation
// (component) are covered in one place.

type DeadlineStatus = "QUALIFIED" | "DUE_SOON" | "OVERDUE" | "UNKNOWN";

function computeDeadlineStatus(
  lastQualAt: string | null | undefined,
  nowMs: number,
): DeadlineStatus {
  if (!lastQualAt) return "UNKNOWN";
  const lastMs     = new Date(lastQualAt).getTime();
  const deadlineMs = lastMs + 24 * 60 * 60 * 1000;
  const warnMs     = lastMs + 20 * 60 * 60 * 1000;
  if (nowMs >= deadlineMs) return "OVERDUE";
  if (nowMs >= warnMs)     return "DUE_SOON";
  return "QUALIFIED";
}

// ── Scheduler mutation tests ──────────────────────────────────────────────────

describe("lastQualifyingTradeAt — scheduler mutations", () => {
  it("is set to cycleId after a live EXECUTED cycle", async () => {
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 100,  // 10% volatile, risk-on target = 80% → buy volatile
      stableValueUsd: 850,
      deps: makeDeps(store),
    });
    expect(result.action).toBe("EXECUTED");
    expect(store.state.lastQualifyingTradeAt).toBeTruthy();
    expect(store.state.lastQualifyingTradeAt).toBe(result.auditEntry.cycleId);
  });

  it("is set to cycleId after a live FALLBACK_EXECUTED cycle", async () => {
    // riskOffOverride suppresses the stable→volatile proposal → falls through to fallback
    const store = makeStore({
      riskOffOverride: { active: true, setAt: "2026-06-19T10:00:00Z" },
    });
    const result = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 100,
      stableValueUsd: 850,
      deps: makeDeps(store),
    });
    expect(result.action).toBe("FALLBACK_EXECUTED");
    expect(store.state.lastQualifyingTradeAt).toBeTruthy();
    expect(store.state.lastQualifyingTradeAt).toBe(result.auditEntry.cycleId);
  });

  it("is NOT set on a dry-run cycle", async () => {
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 100,
      stableValueUsd: 850,
      deps: makeDeps(store, { dryRun: true }),
    });
    expect(result.action).toBe("EXECUTED");
    // dryRun does not save state, so the field is never written
    expect(store.state.lastQualifyingTradeAt).toBeUndefined();
  });

  it("is NOT set on SKIPPED (today already recorded as EXECUTED)", async () => {
    const store = makeStore({
      dayLedger: {
        [TODAY]: {
          date: TODAY,
          status: "EXECUTED",
          action: "EXECUTED",
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
    expect(store.state.lastQualifyingTradeAt).toBeUndefined();
  });

  it("is NOT set on BLOCKED (execution failure)", async () => {
    // Path 2: trade proposed, execution fails → BLOCKED (does not fall through)
    const store = makeStore();
    const result = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 100,
      stableValueUsd: 850,
      deps: makeDeps(store, { executeTrade: stubExecFail }),
    });
    expect(result.action).toBe("BLOCKED");
    expect(store.state.lastQualifyingTradeAt).toBeUndefined();
  });

  it("is updated to the newer cycleId when a fresh qualifying trade runs later", async () => {
    const oldTimestamp = "2026-06-18T08:00:00.000Z";
    const store = makeStore({
      lastQualifyingTradeAt: oldTimestamp,
    });
    const result = await runScheduler({
      totalValueUsd: 1000,
      volatileValueUsd: 100,
      stableValueUsd: 850,
      deps: makeDeps(store),
    });
    expect(result.action).toBe("EXECUTED");
    expect(store.state.lastQualifyingTradeAt).not.toBe(oldTimestamp);
    expect(store.state.lastQualifyingTradeAt).toBe(result.auditEntry.cycleId);
  });
});

// ── Rolling deadline status computation ──────────────────────────────────────
// Verifies the derivation logic that SchedulerStatusCard uses to show
// QUALIFIED / DUE_SOON / OVERDUE badges from lastQualifyingTradeAt.

describe("computeDeadlineStatus — rolling 24h window", () => {
  const BASE_ISO = "2026-06-19T00:00:00.000Z";
  const BASE_MS  = new Date(BASE_ISO).getTime();

  it("returns QUALIFIED at t=0 (trade just happened)", () => {
    expect(computeDeadlineStatus(BASE_ISO, BASE_MS)).toBe("QUALIFIED");
  });

  it("returns QUALIFIED when last trade was 19h ago (under warn threshold)", () => {
    const nowMs = BASE_MS + 19 * 60 * 60 * 1000;
    expect(computeDeadlineStatus(BASE_ISO, nowMs)).toBe("QUALIFIED");
  });

  it("returns DUE_SOON at exactly the 20h warn boundary", () => {
    const nowMs = BASE_MS + 20 * 60 * 60 * 1000;
    expect(computeDeadlineStatus(BASE_ISO, nowMs)).toBe("DUE_SOON");
  });

  it("returns DUE_SOON when last trade was 22h ago (between warn and deadline)", () => {
    const nowMs = BASE_MS + 22 * 60 * 60 * 1000;
    expect(computeDeadlineStatus(BASE_ISO, nowMs)).toBe("DUE_SOON");
  });

  it("returns OVERDUE at exactly the 24h deadline boundary", () => {
    const nowMs = BASE_MS + 24 * 60 * 60 * 1000;
    expect(computeDeadlineStatus(BASE_ISO, nowMs)).toBe("OVERDUE");
  });

  it("returns OVERDUE when last trade was > 24h ago", () => {
    const nowMs = BASE_MS + 30 * 60 * 60 * 1000;
    expect(computeDeadlineStatus(BASE_ISO, nowMs)).toBe("OVERDUE");
  });

  it("returns UNKNOWN when lastQualifyingTradeAt is null", () => {
    expect(computeDeadlineStatus(null, BASE_MS)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when lastQualifyingTradeAt is undefined", () => {
    expect(computeDeadlineStatus(undefined, BASE_MS)).toBe("UNKNOWN");
  });
});
