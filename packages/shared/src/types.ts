// Keel shared types — spot-only, BSC, mock-data shapes for the dashboard.
// Forbidden: perps, futures, leverage, long, short, entry price, mark price,
// liquidation, order book. Every "position" is a spot holding.

export type AssetSymbol =
  | "BTC"
  | "ETH"
  | "CAKE"
  | "LINK"
  | "USDT"
  | "USDC"
  | "USD1"
  | "FDUSD"
  | "BNB";

export type AssetRole = "Volatile" | "Stable" | "Gas";

export type AgentStatus = "Running" | "Paused" | "Error";

export type RiskMode = "Risk-on" | "Neutral" | "Risk-off";

export type SwapAction = "Buy" | "Sell" | "Rebalance" | "Hold";

export type HealthStatus = "ok" | "warn" | "error" | "not_yet_verified";

// ── Portfolio value ─────────────────────────────────────────────────────────

export interface PortfolioValuePoint {
  timestamp: string; // ISO-8601
  valueUsd: number;
}

export interface PortfolioValue {
  currentUsd: number;
  change24hUsd: number;
  change24hPct: number;
  series: PortfolioValuePoint[]; // last 24 h at 5-min resolution
}

// ── PnL ─────────────────────────────────────────────────────────────────────

export interface PnL {
  realizedUsd: number;
  unrealizedUsd: number;
  totalUsd: number;
  change24hPct: number;
}

// ── Exposure ─────────────────────────────────────────────────────────────────

export interface Exposure {
  volatilePct: number; // e.g. 78
  stablePct: number;   // e.g. 20
  gasPct: number;      // e.g. 2  (BNB only)
}

// ── Spot holdings ────────────────────────────────────────────────────────────

export interface SpotHolding {
  asset: AssetSymbol;
  role: AssetRole;
  balance: number;
  valueUsd: number;
  allocationPct: number;
  change24hPct: number | null;
}

// ── Allocation (donut) ───────────────────────────────────────────────────────

export interface AllocationSlice {
  asset: AssetSymbol;
  role: AssetRole;
  pct: number;
  valueUsd: number;
  color: string;
}

// ── Market signals ───────────────────────────────────────────────────────────

export interface MarketSignals {
  fearGreed: number;         // 0-100
  fearGreedLabel: string;    // e.g. "Fear"
  change1hPct: number;       // basket-level % change
  change24hPct: number;
  trend: "Bullish" | "Bearish" | "Neutral";
  assetPrice: number;        // primary volatile asset (ETH) USD price
  assetSymbol: AssetSymbol;
}

// ── Risk score ────────────────────────────────────────────────────────────────

export interface RiskComponent {
  label: string;       // "1h Change" | "24h Change" | "Fear & Greed"
  value: number;       // raw input (%, %, 0-100)
  contribution: number; // 0-1, the weighted component
}

export interface RiskScore {
  R: number;                 // 0-1
  mode: RiskMode;
  targetVolatilePct: number; // 80 | 45 | 18
  components: [RiskComponent, RiskComponent, RiskComponent];
}

// ── Drawdown ──────────────────────────────────────────────────────────────────

export interface DrawdownPoint {
  timestamp: string;
  drawdownPct: number; // negative, e.g. -4.2
}

export interface DrawdownState {
  currentPct: number;      // e.g. -4.2
  limitPct: number;        // alert threshold, e.g. -12
  killSwitchPct: number;   // hard backstop, e.g. -18
  highWaterMarkUsd: number;
  series: DrawdownPoint[];
}

// ── Swap ──────────────────────────────────────────────────────────────────────

export interface Swap {
  id: string;
  timestamp: string;
  fromAsset: AssetSymbol;
  toAsset: AssetSymbol;
  amountIn: number;
  amountOut: number;
  valueUsd: number;
  priceImpactPct: number;
  slippagePct: number;
  reason: string;
  txHash: string;
  explorerUrl: string;
}

// ── Proof trail ──────────────────────────────────────────────────────────────

export type ProofEntryType =
  | "Decision"
  | "SwapExecution"
  | "x402Confirmation"
  | "AgentIdentity"
  | "Network";

export interface ProofEntry {
  id: string;
  type: ProofEntryType;
  label: string;
  timestamp: string;
  txHash?: string;
  explorerUrl?: string;
  verified: boolean;
  detail: string;
}

// ── x402 ──────────────────────────────────────────────────────────────────────

export interface X402Confirmation {
  totalConfirmed: number;
  lastConfirmedAt: string | null;
  lastAmountUsdc: number | null; // e.g. 0.01
  settlementChain: "Base" | "BSC";
}

// ── Swap / Decision log ───────────────────────────────────────────────────────

export interface SwapLogRow {
  id: string;
  timestamp: string;
  mode: RiskMode;
  action: SwapAction;
  fromAsset: AssetSymbol;
  toAsset: AssetSymbol;
  sizeIn: number;
  valueUsd: number;
  reason: string;
  txHash: string | null;
  explorerUrl: string | null;
}

// ── System health ─────────────────────────────────────────────────────────────

export interface HealthItem {
  label: string;
  status: HealthStatus;
  detail: string;
}

// ── Agent perception output (raw CMC snapshot) ───────────────────────────────
// Matches the verified CMC REST fields: data[symbol].quote.USD.*
// and data.value from v3/fear-and-greed/latest.

export interface MarketSnapshot {
  symbol: string;       // e.g. "ETH"
  price: number;        // USD price
  change1h: number;     // percent_change_1h
  change24h: number;    // percent_change_24h
  fearGreed: number;    // 0–100 from v3/fear-and-greed/latest
  fetchedAt: string;    // ISO-8601
}

// ── Policy config (all tunable thresholds from risk-policy.md) ───────────────

export interface PolicyConfig {
  // Risk engine weights (must sum to 1.0)
  change1hWeight: number;    // default 0.4
  change24hWeight: number;   // default 0.4
  fearGreedWeight: number;   // default 0.2

  // Risk engine scales
  change1hScale: number;     // default 3  — |c1h| / scale before weight
  change24hScale: number;    // default 10 — |c24h| / scale before weight
  fearGreedNeutral: number;  // default 60 — greed premium above this

  // Mode thresholds
  riskOnThreshold: number;   // default 0.33
  riskOffThreshold: number;  // default 0.66

  // Target volatile exposure per mode (spot holdings, not perps)
  riskOnTargetPct: number;   // default 80
  neutralTargetPct: number;  // default 45
  riskOffTargetPct: number;  // default 18  — NEVER 0

  // Guardrails
  perTradeCapFraction: number;  // default 0.25 — max single swap as fraction of portfolio
  minTradeValueUsd?: number;    // optional — skip trades below this USD value (e.g. 1.25 for Bitget)
  dailyLossCapPct: number;      // default 5    — % of portfolio, halts new risk
  maxSlippagePct: number;      // default 1.0  — rejects if TWAK priceImpact exceeds this
  drawdownAlertPct: number;    // default -12  — warn threshold (< 0)
  killSwitchPct: number;       // default -18  — hard backstop (< drawdownAlertPct)

  // Anti-churn
  rebalanceBandPct: number;    // default 5    — only rebalance if deviation > this

  // Daily qualification scheduler — fallback stable-to-stable swap minimum size
  fallbackSwapSizeUsd: number; // default 2    — minimum drawdown-neutral fallback swap

  // ── Post-formula overlay thresholds (drawdown + Hub enrichments) ───────────
  // These are additive clamps on the engine's output — they can only lower
  // the volatile target, never raise it. The engine formula is untouched.
  drawdownOverlayStartPct: number;       // default -8   — overlay kicks in below this (< 0)
  drawdownOverlayCap: number;            // default 45   — max volatile % in overlay zone
  emergencyModeThresholdPct: number;     // default -14  — emergency: only de-risk allowed

  // Hub enrichment overlay caps (get_upcoming_macro_events)
  macroEventWindowHours: number;         // default 24   — pre-event de-risk window (hours)
  macroEventTargetCap: number;           // default 30   — volatile % cap inside window

  // Hub enrichment overlay caps (get_crypto_technical_analysis)
  rsiCautionThreshold: number;           // default 75   — RSI above this triggers caution
  rsiCautionTargetCap: number;           // default 45   — volatile % cap when RSI is high

  // Hub enrichment overlay caps (get_global_metrics_latest)
  btcDominanceRiskOffThreshold: number;  // default 55   — BTC dom % above this = risk-off regime
  btcDominanceTargetCap: number;         // default 45   — volatile % cap in risk-off regime
}

// ── Guardrail check result ────────────────────────────────────────────────────

export interface GuardrailResult {
  ok: boolean;
  guardName: string;
  reason: string;
}

// ── Kill-switch result (specialised guardrail) ────────────────────────────────

export interface KillSwitchResult {
  triggered: boolean;
  action: "hold" | "flatten-to-stables"; // never "drain-to-dust"
  drawdownPct: number;
  reason: string;
}

// ── Trade proposal (pre-execution decision, no funds) ────────────────────────

export interface TradeProposal {
  fromAsset: AssetSymbol;
  toAsset: AssetSymbol;
  amountIn: number;           // in fromAsset units
  estimatedValueUsd: number;
  reason: string;
  mode: RiskMode;
  R: number;
}

// ── TWAK quote output (confirmed fields from verify-in-docs.md §6) ───────────
// Returned by: twak swap <amt> <from> <to> --chain bsc --slippage <pct> --quote-only --json
// All fields may be string or number depending on CLI version.

export interface TwakQuote {
  input: string | number;
  output: string | number;
  minReceived: string | number;
  provider: string;
  priceImpact: string | number;
}

// ── Portfolio state (current holdings snapshot for the decision cycle) ────────

export interface PortfolioState {
  totalValueUsd: number;
  volatileValueUsd: number;
  stableValueUsd: number;
  highWaterMarkUsd: number;
  dailyLossUsd: number;
}

// ── Execution plan (pure: the command that WOULD run, never spawned here) ─────

export interface ExecutionPlan {
  command: string;
  args: string[];
  proposal: TradeProposal;
  quote: TwakQuote | null;
  dryRun: boolean;
}

// ── Execution result (returned by the gated live execute path) ────────────────
// ok:true  → swap was sent; txHash and explorerUrl are set.
// ok:false → runner threw or TWAK returned an error; error is set.

export interface ExecutionResult {
  ok: boolean;
  txHash?: string;          // BSC tx hash when the swap succeeded
  explorerUrl?: string;     // https://bscscan.com/tx/<txHash>
  error?: string;           // set when ok is false
  amountOut?: number | null;       // output token amount — parsed from TWAK stdout if present
  slippagePct?: number | null;     // realized slippage % — parsed from TWAK stdout if present
  priceImpactPct?: number | null;  // price impact % — parsed from TWAK stdout if present
}

// ── Cycle result (output of one full decision cycle) ─────────────────────────

export interface CycleResult {
  timestamp: string;
  snapshot: MarketSnapshot;
  riskScore: RiskScore;
  mode: RiskMode;
  proposal: TradeProposal | null;
  executionPlan: ExecutionPlan | null;
  wouldBeCommand: string | null;
  guardrailResults: GuardrailResult[];
  killSwitchResult: KillSwitchResult;
  reason: string;
}

// ── Hub enrichment signals (best-effort — all optional) ──────────────────────
// Numeric inputs from the CMC Agent Hub; each is skipped silently when absent.

export interface HubSignals {
  rsi?: number;                    // from get_crypto_technical_analysis
  hoursToNextMacroEvent?: number;  // from get_upcoming_macro_events
  btcDominancePct?: number;        // from get_global_metrics_latest
}

// ── Hub attempt record (per-cycle observability) ──────────────────────────────
// Present only when HUB_ENABLED=yes. Each field is "ok" or the error message
// returned by that tool call. Allows post-hoc diagnosis of Hub outages.

export interface HubAttempt {
  price:  string;   // "ok" | error message
  ta:     string;   // "ok" | error message
  macro:  string;   // "ok" | error message
  btcDom: string;   // "ok" | error message
}

// ── Overlay input (engine output + context for post-formula clamps) ───────────

export interface OverlayInput {
  modeTarget: number;   // volatile target % from engine: 80 | 45 | 18
  drawdownPct: number;  // current drawdown from HWM (negative, e.g. -10)
  hub?: HubSignals;     // best-effort Hub enrichment signals (skipped when absent)
}

// ── One applied overlay (an entry in the per-cycle audit trail) ───────────────

export interface AppliedOverlay {
  name: string;            // "drawdown" | "emergency" | "macro-event" | "ta-caution" | "regime-bias"
  originalTarget: number;  // volatile target % before this overlay (always ≥ adjustedTarget)
  adjustedTarget: number;  // volatile target % after this overlay
  reason: string;
}

// ── Overlay stack result ──────────────────────────────────────────────────────

export interface OverlayResult {
  finalTarget: number;               // clamped volatile target % to use in cycle decisions
  overlaysApplied: AppliedOverlay[];
  emergencyMode: boolean;            // true when near kill-switch; only de-risk allowed
}

// ── Signals result (per-cycle output of Hub + REST aggregation) ──────────────

export interface SignalsResult {
  snapshot: MarketSnapshot;       // price/1h/24h/fearGreed — price may come from Hub or REST
  hub: HubSignals;                // Hub enrichment signals (empty when Hub disabled or failed)
  priceSource: "hub" | "rest";   // which source provided price data this cycle
  hubConnected: boolean;          // whether the Hub responded successfully this cycle
  hubAttempt?: HubAttempt;        // per-tool status when HUB_ENABLED=yes; absent otherwise
}

// ── x402 payment proof (Base chain — STRICTLY SEPARATE from BSC trade proof) ─
// Settlement is always USDC on Base (Chain ID 8453). Never conflate with BSC.

export interface X402PaymentProof {
  txHash: string;       // Base transaction hash (NOT a BSC hash)
  chain: "Base";        // always Base for x402 settlement
  chainId: number;      // 8453 (Base)
  amountUsdc: number;   // amount paid (e.g. 0.01)
  settledAt: string;    // ISO-8601
  url: string;          // the paid endpoint URL
  explorerUrl: string;  // https://basescan.org/tx/<txHash>
}

// ── Scheduler action (per-day outcome of the daily qualification scheduler) ────

export type SchedulerAction =
  | "EXECUTED"           // normal trade executed (normal cycle or risk-reducing rebalance)
  | "FALLBACK_EXECUTED"  // drawdown-neutral fallback qualification attempt (stable-to-stable)
  | "KILL_SWITCH"        // kill-switch triggered; volatile→stable flattening executed
  | "BLOCKED"            // all paths blocked; see blockedReason
  | "SKIPPED";           // already executed today (idempotent re-invocation)

// ── Day ledger entry (one record per calendar date) ───────────────────────────

export interface DayAttemptEntry {
  date: string;               // ISO date key "2026-06-19"
  status: "EXECUTED" | "BLOCKED" | "SKIPPED";
  action?: SchedulerAction;   // specific scheduler action
  txHash?: string;            // BSC tx hash when EXECUTED or KILL_SWITCH
  blockedReason?: string;     // human-readable reason when BLOCKED
  timestamp: string;          // ISO-8601 of attempt
}

// ── Persisted agent state (survives process restarts) ─────────────────────────

export interface AgentPersistentState {
  highWaterMarkUsd: number;
  dailyLossStartUsd: number;  // portfolio value at start of the current trading day
  dayLedger: Record<string, DayAttemptEntry>; // dateKey → attempt entry
  lastUpdated: string;        // ISO-8601
  // Set by the dashboard; cleared by the scheduler after one full cycle executes.
  // When active, any stable→volatile (risk-increasing) trade proposal is suppressed
  // and the cycle falls through to the fallback qualification attempt.
  riskOffOverride?: {
    active: boolean;
    setAt: string;  // ISO-8601 of when the override was requested
  };
  lastQualifyingTradeAt?: string; // ISO-8601 of last EXECUTED or FALLBACK_EXECUTED live cycle
}

// ── Projected-drawdown gate result (§4 asymmetric pre-execution check) ────────
// Asymmetric: risk-reducing (volatile→stable) always passes.
// Risk-increasing (stable→volatile) is blocked in overlay/emergency zones.

export interface DrawdownGateResult {
  ok: boolean;
  guardName: "projected-drawdown";
  reason: string;
  projectedVolatilePct?: number;  // computed for risk-increasing trades only
  isRiskReducing: boolean;
}

// ── Audit log entry (one per scheduler cycle) ─────────────────────────────────
// Full per-cycle record: signals → overlays → risk → gate → action → proof.
// BSC trade hashes and Base x402 proofs are in separate, named fields.

export interface AuditEntry {
  cycleId: string;                     // ISO-8601 cycle start time (unique run ID)
  date: string;                        // "2026-06-19"
  priceSource: "hub" | "rest";         // which source provided price data this cycle
  hubConnected: boolean;
  hubSignals: HubSignals;              // Hub enrichment (empty when Hub disabled or failed)
  overlaysApplied: AppliedOverlay[];   // overlays that clamped the target this cycle
  emergencyMode: boolean;
  riskScore: RiskScore;
  mode: RiskMode;
  adjustedTargetPct: number;           // final volatile target after all overlays
  proposal: TradeProposal | null;      // trade proposal (null when HOLD)
  drawdownGate: DrawdownGateResult | null; // projected-drawdown gate result
  guardrailResults: GuardrailResult[]; // existing gate chain results
  killSwitchTriggered: boolean;
  action: SchedulerAction;
  txHash?: string;                     // BSC tx hash (NEVER a Base/x402 hash)
  bitgetOrderId?: string;              // Bitget orderId returned by place-order (patched in post-execution)
  x402Proof?: X402PaymentProof;        // Base payment proof — strictly separate from BSC
  blockedReason?: string;
  dryRun?: boolean;                    // true when produced by a dry-run cycle; no funds moved
  hubAttempt?: HubAttempt;             // per-tool Hub status when HUB_ENABLED=yes; absent otherwise
  amountOut?: number | null;           // output token amount from the executed swap
  slippagePct?: number | null;         // realized slippage % (computed from quote output vs minReceived)
  priceImpactPct?: number | null;      // price impact % from TWAK quote/execute output
  assetPriceUsd?: number | null;       // ETH USD price at cycle time (from Hub or REST)
}

// ── Portfolio snapshot (persisted after every runner cycle) ──────────────────
// Written to data/portfolio-snapshot.json by the runner; read by the dashboard.
// Source priority: (1) TWAK balance query, (2) this file, (3) env vars (SIMULATION).

export type PortfolioFreshness = "LIVE" | "STALE" | "UNAVAILABLE";

export interface PortfolioSnapshot {
  snapshotAt: string;                // ISO-8601 of when snapshot was taken
  portfolioUsd: number;
  tokenBalances: Partial<Record<AssetSymbol, { balance: number; valueUsd: number; change24hPct?: number | null }>>;
  allocation: { volatilePct: number; stablePct: number; gasPct: number };
  hwm: number;
  currentDrawdownPct: number;
  lastBscTxHash: string | null;
  lastCycleResult: SchedulerAction | null;
  source: "twak" | "bitget" | "env"; // which source provided the portfolio numbers
}

// ── Agent state (top-level for the dashboard) ─────────────────────────────────

export interface AgentState {
  status: AgentStatus;
  mode: RiskMode;
  walletAddress: string;
  lastUpdated: string;
  portfolioValue: PortfolioValue;
  pnl: PnL;
  exposure: Exposure;
  latestSwap: Swap;
  drawdown: DrawdownState;
  holdings: SpotHolding[];
  allocation: AllocationSlice[];
  marketSignals: MarketSignals;
  riskScore: RiskScore;
  proofTrail: ProofEntry[];
  x402: X402Confirmation;
  swapLog: SwapLogRow[];
  systemHealth: HealthItem[];
}
