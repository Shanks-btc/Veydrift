// §3 — Daily qualification scheduler.
//
// Idempotent per calendar day: re-invocation after a restart will return SKIPPED
// when the day's attempt has already completed.
//
// Hierarchy (lowest-risk first):
//   1. Kill-switch override (emergency, bypasses daily idempotency)
//   2. Normal cycle trade — if the cycle produces a valid executionPlan and the
//      §4 projected-drawdown gate passes → execute.
//   3. Fallback qualification attempt — minimum-size drawdown-neutral
//      stable-to-stable swap (USDT → USDC) when the day is otherwise calm.
//   4. BLOCKED — log reason; do NOT fabricate a trade.
//
// Honesty invariant (§0a): the fallback is labelled a "fallback qualification
// attempt" — never "guaranteed qualifying trade" or "DQ-proof".
//
// All I/O is injectable so tests use stubs with zero network/spend.

import type {
  PolicyConfig,
  PortfolioState,
  TradeProposal,
  ExecutionPlan,
  ExecutionResult,
  AuditEntry,
  SchedulerAction,
  AgentPersistentState,
  DayAttemptEntry,
  DrawdownGateResult,
  GuardrailResult,
} from "@veydrift/shared";
import type { RestFetcher } from "../perception/signals.js";
import type { HubToolRunner } from "../perception/hub.js";
import type { QuoteRunner, LiveRunner } from "../execution/twak.js";
import { fetchSignals } from "../perception/signals.js";
import { applyAllOverlays } from "../risk/overlays.js";
import { computeRiskScore } from "../risk/engine.js";
import { runCycle } from "./cycle.js";
import { evaluateTrade } from "./gate.js";
import { checkProjectedDrawdown } from "./drawdown-gate.js";
import { buildExecutePlan, execute } from "../execution/twak.js";
import { computeDrawdown } from "../guardrails/killSwitch.js";
import { DEFAULT_POLICY } from "../config.js";
import {
  getDayKey,
  loadState as fileLoadState,
  saveState as fileSaveState,
  updateHwm,
  recordDayAttempt,
} from "../state/persistence.js";
import { appendAuditEntry as fileAppendAudit } from "../state/audit.js";

// ── Swap metric helpers ───────────────────────────────────────────────────────

// Parse a string | number quote field to a number, null on failure.
function parseQuoteNum(val: string | number): number | null {
  const n = typeof val === "number" ? val : parseFloat(val);
  return isNaN(n) ? null : n;
}

// Derive amountOut / priceImpactPct / slippagePct for an executed trade.
// Priority: execute-stdout values (when TWAK returns them) → pre-trade quote → null.
// All outputs are nullable — never fabricated.
function deriveSwapMetrics(
  execResult: ExecutionResult,
  plan: ExecutionPlan,
): { amountOut: number | null; priceImpactPct: number | null; slippagePct: number | null } {
  // Use execute-stdout values when present
  if (execResult.amountOut != null || execResult.priceImpactPct != null) {
    return {
      amountOut: execResult.amountOut ?? null,
      priceImpactPct: execResult.priceImpactPct ?? null,
      slippagePct: execResult.slippagePct ?? null,
    };
  }
  // Fall back to pre-trade quote (confirmed shape: output, priceImpact, minReceived)
  const q = plan.quote;
  if (!q) return { amountOut: null, priceImpactPct: null, slippagePct: null };
  const amountOut = parseQuoteNum(q.output);
  const priceImpactPct = parseQuoteNum(q.priceImpact);
  const minReceived = parseQuoteNum(q.minReceived);
  const slippagePct =
    amountOut !== null && amountOut > 0 && minReceived !== null
      ? ((amountOut - minReceived) / amountOut) * 100
      : null;
  return { amountOut, priceImpactPct, slippagePct };
}

// ── Primary pair for fallback swap (both eligible stables, BSC-routed) ────────

const FALLBACK_FROM = "USDT" as const;
const FALLBACK_TO = "USDC" as const;

// Stable asset symbols — a trade from any of these to a non-stable is risk-increasing.
const STABLES = new Set<string>(["USDT", "USDC", "USD1", "FDUSD"]);

// ── Injectable dependencies ───────────────────────────────────────────────────

export interface SchedulerDeps {
  restFetcher?: RestFetcher;
  hubRunner?: HubToolRunner;
  quoteRunner?: QuoteRunner;
  liveRunner?: LiveRunner;
  // State / audit functions (inject in-memory stubs in tests; omit for real file I/O)
  loadState?: (dataDir: string) => AgentPersistentState;
  saveState?: (state: AgentPersistentState, dataDir: string) => void;
  appendAudit?: (entry: AuditEntry, dataDir: string) => void;
  // Trade execution (inject a stub in tests; omit to use execute("live", liveRunner))
  executeTrade?: (plan: ExecutionPlan) => ExecutionResult;
  stateDir?: string;
  now?: () => Date;
  // Dry-run: skip day-ledger writes and state persistence; tag audit entry with dryRun: true.
  // Audit log IS written so the cycle is observable. No funds move.
  dryRun?: boolean;
}

// ── I/O types ─────────────────────────────────────────────────────────────────

export interface SchedulerInput {
  // Current portfolio values (from wallet balance check or test stub)
  totalValueUsd: number;
  volatileValueUsd: number;
  stableValueUsd: number;
  policy?: PolicyConfig;
  deps?: SchedulerDeps;
}

export interface SchedulerResult {
  action: SchedulerAction;
  date: string;
  txHash?: string;
  blockedReason?: string;
  auditEntry: AuditEntry;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runScheduler(input: SchedulerInput): Promise<SchedulerResult> {
  const {
    totalValueUsd,
    volatileValueUsd,
    stableValueUsd,
    policy = DEFAULT_POLICY,
    deps = {},
  } = input;

  const {
    restFetcher,
    hubRunner,
    quoteRunner,
    liveRunner,
    loadState: loadStateFn = fileLoadState,
    saveState: saveStateFn = fileSaveState,
    appendAudit: appendAuditFn = fileAppendAudit,
    executeTrade: executeTradeInjected,
    stateDir = "./data",
    now = () => new Date(),
    dryRun = false,
  } = deps;

  const cycleId = now().toISOString();
  const today = getDayKey(now());

  // Resolve the trade-execution function (injectable so tests never touch live gate)
  const doExecute = executeTradeInjected
    ?? ((plan: ExecutionPlan): ExecutionResult => execute(plan, "live", liveRunner));

  // ── 1. Load persistent state ────────────────────────────────────────────────
  const state = loadStateFn(stateDir);

  // Reset daily-loss baseline at the start of each new calendar day
  if (!state.dayLedger[today]) {
    state.dailyLossStartUsd = totalValueUsd;
  }

  // ── 2. Build portfolio state (persisted HWM overrides any stale value) ──────
  const hwm = Math.max(state.highWaterMarkUsd, totalValueUsd);
  const portfolio: PortfolioState = {
    totalValueUsd,
    volatileValueUsd,
    stableValueUsd,
    highWaterMarkUsd: hwm,
    dailyLossUsd: Math.max(0, state.dailyLossStartUsd - totalValueUsd),
  };

  // ── 3. Fetch signals (REST always; Hub when enabled) ────────────────────────
  const signals = await fetchSignals("ETH", hubRunner, restFetcher);
  const { snapshot, hub, priceSource, hubConnected, hubAttempt } = signals;

  // ── 4. Compute drawdown and apply post-formula overlays ─────────────────────
  const currentVolatilePct =
    totalValueUsd > 0 ? (volatileValueUsd / totalValueUsd) * 100 : 0;
  const currentDrawdownPct = computeDrawdown(totalValueUsd, hwm);

  const engineTarget = computeRiskScore(snapshot, policy).targetVolatilePct;
  const overlayResult = applyAllOverlays(
    { modeTarget: engineTarget, drawdownPct: currentDrawdownPct, hub },
    policy,
  );
  const { finalTarget: adjustedTargetPct, overlaysApplied, emergencyMode } = overlayResult;

  // ── 5. Run the core decision cycle ─────────────────────────────────────────
  const cycleResult = runCycle({ snapshot, portfolio, policy, runner: quoteRunner });
  const killSwitchTriggered = cycleResult.killSwitchResult.triggered;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Shared opts shape for buildAudit and conclude (kept in sync).
  type ConcludeOpts = {
    proposal?: TradeProposal | null;
    drawdownGate?: DrawdownGateResult | null;
    guardrailResults?: GuardrailResult[];
    txHash?: string;
    blockedReason?: string;
    amountOut?: number | null;
    slippagePct?: number | null;
    priceImpactPct?: number | null;
  };

  function buildAudit(action: SchedulerAction, opts: ConcludeOpts = {}): AuditEntry {
    return {
      cycleId,
      date: today,
      priceSource,
      hubConnected,
      hubSignals: hub,
      overlaysApplied,
      emergencyMode,
      riskScore: cycleResult.riskScore,
      mode: cycleResult.mode,
      adjustedTargetPct,
      proposal: opts.proposal !== undefined ? opts.proposal : cycleResult.proposal,
      drawdownGate: opts.drawdownGate ?? null,
      guardrailResults: opts.guardrailResults ?? cycleResult.guardrailResults,
      killSwitchTriggered,
      action,
      txHash: opts.txHash,
      blockedReason: opts.blockedReason,
      dryRun: dryRun || undefined,
      hubAttempt,
      assetPriceUsd: snapshot.price,
      amountOut: opts.amountOut ?? null,
      slippagePct: opts.slippagePct ?? null,
      priceImpactPct: opts.priceImpactPct ?? null,
    };
  }

  // Force Risk-Off override: set by the dashboard; suppresses risk-increasing trades
  // for one cycle. Active only in live mode (dryRun cycles never clear it).
  const riskOffOverrideActive = state.riskOffOverride?.active === true && !dryRun;

  function conclude(action: SchedulerAction, opts: ConcludeOpts = {}): SchedulerResult {
    // Always update HWM in memory. Persist state and day ledger only for real cycles.
    updateHwm(state, totalValueUsd);

    // Clear risk-off override after one complete live cycle (any action except SKIPPED).
    if (riskOffOverrideActive && action !== "SKIPPED") {
      state.riskOffOverride = { active: false, setAt: state.riskOffOverride!.setAt };
    }

    // Record the last qualifying trade timestamp for the rolling 24h deadline display.
    // Warning-only — no gate, no logic change. dryRun cycles never qualify.
    if (!dryRun && (action === "EXECUTED" || action === "FALLBACK_EXECUTED")) {
      state.lastQualifyingTradeAt = cycleId;
    }

    if (action !== "SKIPPED" && !dryRun) {
      const dayStatus = action === "BLOCKED" ? "BLOCKED" : "EXECUTED";
      const entry: DayAttemptEntry = {
        date: today,
        status: dayStatus,
        action,
        txHash: opts.txHash,
        blockedReason: opts.blockedReason,
        timestamp: cycleId,
      };
      recordDayAttempt(state, entry);
    }

    if (!dryRun) {
      saveStateFn(state, stateDir);
    }
    const auditEntry = buildAudit(action, opts);
    appendAuditFn(auditEntry, stateDir);

    return {
      action,
      date: today,
      txHash: opts.txHash,
      blockedReason: opts.blockedReason,
      auditEntry,
    };
  }

  // ── Path 1: Kill-switch override ─────────────────────────────────────────────
  // Emergency: bypass daily idempotency. Risk-reducing flattening is always allowed.
  if (killSwitchTriggered && cycleResult.executionPlan && volatileValueUsd > 0) {
    const execResult = doExecute(cycleResult.executionPlan);
    if (execResult.ok) {
      return conclude("KILL_SWITCH", {
        proposal: cycleResult.proposal,
        txHash: execResult.txHash,
        ...deriveSwapMetrics(execResult, cycleResult.executionPlan),
      });
    }
    return conclude("BLOCKED", {
      proposal: cycleResult.proposal,
      blockedReason: `kill-switch execution failed: ${execResult.error ?? "unknown"}`,
    });
  }

  // ── Idempotency check ────────────────────────────────────────────────────────
  const todayEntry = state.dayLedger[today];
  if (todayEntry?.status === "EXECUTED" || todayEntry?.status === "BLOCKED") {
    return conclude("SKIPPED");
  }

  // ── Path 2: Normal trade ─────────────────────────────────────────────────────
  // The cycle already ran evaluateTrade internally. If executionPlan is non-null,
  // the existing gate chain passed. We now run the §4 projected-drawdown gate
  // as an additive pre-execution check.
  if (cycleResult.executionPlan !== null && cycleResult.proposal !== null) {
    const proposal = cycleResult.proposal;

    // Force Risk-Off override: suppress stable→volatile (risk-increasing) trades
    // for this cycle and fall through to the fallback qualification attempt instead.
    const isRiskIncreasing = STABLES.has(proposal.fromAsset) && !STABLES.has(proposal.toAsset);
    if (riskOffOverrideActive && isRiskIncreasing) {
      console.log("[veydrift scheduler] force-risk-off override active — suppressing stable→volatile trade");
      // Falls through to Path 3 (fallback qualification attempt) below
    } else {
      const drawdownGate = checkProjectedDrawdown({
        fromAsset: proposal.fromAsset,
        toAsset: proposal.toAsset,
        tradeValueUsd: proposal.estimatedValueUsd,
        portfolioValueUsd: totalValueUsd,
        currentVolatilePct,
        currentDrawdownPct,
        policy,
      });

      if (drawdownGate.ok) {
        const execResult = doExecute(cycleResult.executionPlan);
        if (execResult.ok) {
          return conclude("EXECUTED", {
            proposal,
            drawdownGate,
            guardrailResults: cycleResult.guardrailResults,
            txHash: execResult.txHash,
            ...deriveSwapMetrics(execResult, cycleResult.executionPlan),
          });
        }
        return conclude("BLOCKED", {
          proposal,
          drawdownGate,
          guardrailResults: cycleResult.guardrailResults,
          blockedReason: `execution failed: ${execResult.error ?? "unknown"}`,
        });
      }
      // Projected-drawdown gate blocked — fall through to fallback
    }
  }

  // ── Path 3: Fallback qualification attempt ───────────────────────────────────
  // Minimum-size drawdown-neutral stable-to-stable swap.
  // Honesty label: "fallback qualification attempt" — NOT "guaranteed qualifying trade".
  // Not guaranteed to satisfy organizers until they confirm stable-to-stable counts.

  const fallbackSize = policy.fallbackSwapSizeUsd;

  if (stableValueUsd < fallbackSize) {
    return conclude("BLOCKED", {
      blockedReason:
        `fallback qualification attempt blocked: insufficient stables ` +
        `(have $${stableValueUsd.toFixed(2)}, need $${fallbackSize})`,
    });
  }

  if (totalValueUsd - fallbackSize < 1) {
    return conclude("BLOCKED", {
      blockedReason:
        "fallback qualification attempt blocked: portfolio would fall below $1 after swap",
    });
  }

  const fallbackProposal: TradeProposal = {
    fromAsset: FALLBACK_FROM,
    toAsset: FALLBACK_TO,
    amountIn: fallbackSize,
    estimatedValueUsd: fallbackSize,
    reason:
      "fallback qualification attempt (drawdown-neutral stable-to-stable swap — " +
      "not guaranteed unless organizers confirm stable-to-stable counts)",
    mode: cycleResult.mode,
    R: cycleResult.riskScore.R,
  };

  // Projected-drawdown gate for the fallback (stable-to-stable is neutral → always passes)
  const fallbackDrawdownGate = checkProjectedDrawdown({
    fromAsset: FALLBACK_FROM,
    toAsset: FALLBACK_TO,
    tradeValueUsd: fallbackSize,
    portfolioValueUsd: totalValueUsd,
    currentVolatilePct,
    currentDrawdownPct,
    policy,
  });

  // Existing gate chain on the fallback proposal
  const fallbackGate = evaluateTrade({
    proposal: fallbackProposal,
    portfolio,
    quote: null,
    policy,
  });

  if (!fallbackGate.approved) {
    return conclude("BLOCKED", {
      proposal: fallbackProposal,
      drawdownGate: fallbackDrawdownGate,
      guardrailResults: fallbackGate.guardrailResults,
      blockedReason:
        `fallback gate blocked: ${fallbackGate.firstFailure?.reason ?? "unknown"}`,
    });
  }

  const fallbackPlan = buildExecutePlan(
    { amountIn: fallbackSize, fromAsset: FALLBACK_FROM, toAsset: FALLBACK_TO },
    null,
    fallbackProposal,
  );

  const fallbackExec = doExecute(fallbackPlan);
  if (fallbackExec.ok) {
    return conclude("FALLBACK_EXECUTED", {
      proposal: fallbackProposal,
      drawdownGate: fallbackDrawdownGate,
      guardrailResults: fallbackGate.guardrailResults,
      txHash: fallbackExec.txHash,
      ...deriveSwapMetrics(fallbackExec, fallbackPlan),
    });
  }

  // Stable-to-stable swaps are not supported on Bitget spot — skip rather than BLOCKED.
  // SKIPPED leaves the day ledger open so the next invocation can try again with a
  // volatile↔stable trade if conditions change.
  if (STABLES.has(fallbackProposal.fromAsset) && STABLES.has(fallbackProposal.toAsset)) {
    console.log(
      `[veydrift scheduler] stable-to-stable fallback not supported ` +
      `(${fallbackProposal.fromAsset}→${fallbackProposal.toAsset}) — logging SKIPPED`,
    );
    return conclude("SKIPPED", {
      proposal: fallbackProposal,
      drawdownGate: fallbackDrawdownGate,
      guardrailResults: fallbackGate.guardrailResults,
    });
  }

  return conclude("BLOCKED", {
    proposal: fallbackProposal,
    drawdownGate: fallbackDrawdownGate,
    guardrailResults: fallbackGate.guardrailResults,
    blockedReason: `fallback execution failed: ${fallbackExec.error ?? "unknown"}`,
  });
}
