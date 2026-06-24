// TWAK execution wrapper.
//
// getQuote():           READ-ONLY quote call; runner is injected so tests
//                       use stub output with zero network calls.
// buildExecutePlan():   PURE function — builds the command args, no spawn.
// execute("dry-run"):  logs + returns plan unchanged.
// execute("live"):     GATED — checks I_UNDERSTAND_REAL_FUNDS and
//                       BNB_WALLET_PASSWORD before spawning; password is
//                       NEVER logged (audit shows <redacted>).

import { execSync } from "child_process";
import type { TwakQuote, TradeProposal, ExecutionPlan, ExecutionResult } from "@veydrift/shared";

// ── Runner types ──────────────────────────────────────────────────────────────

// Injectable runner for getQuote (read-only): (args string) → raw output
export type QuoteRunner = (args: string) => string;

// Injectable runner for live execute: (command, args) → raw output
// Receives the real password in args — never call defaultLiveRunner in tests.
export type LiveRunner = (command: string, args: string[]) => string;

// Default quote runner — uses execSync; inject a stub in tests
const defaultRunner: QuoteRunner = (args: string) =>
  execSync(`npx --yes --package @trustwallet/cli twak ${args}`, {
    encoding: "utf8",
    timeout: 60_000,
  });

// Default live runner — only called when I_UNDERSTAND_REAL_FUNDS=yes and funded.
// The full command string (including the real password in args) is NEVER logged.
const defaultLiveRunner: LiveRunner = (command: string, args: string[]) =>
  execSync([command, ...args].join(" "), {
    encoding: "utf8",
    timeout: 120_000,
  });

// ── JSON parsing (banner-tolerant) ───────────────────────────────────────────

// Internal: extract and parse the JSON blob from raw TWAK output.
// Handles CLI banner / preamble before the JSON (same pattern as keel.cjs asJson).
function extractJson(raw: string): Record<string, unknown> {
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i === -1 || j === -1) {
    throw new Error(`No JSON object found in TWAK output:\n${raw}`);
  }
  return JSON.parse(raw.slice(i, j + 1)) as Record<string, unknown>;
}

// Public: parse a TWAK quote response into the confirmed TwakQuote shape.
export function parseTwakJson(raw: string): TwakQuote {
  return extractJson(raw) as unknown as TwakQuote;
}

// ── Quote ─────────────────────────────────────────────────────────────────────

export interface QuoteParams {
  amountIn: number;
  fromAsset: string;
  toAsset: string;
  chain?: string;
  slippagePct?: number;
}

// READ-ONLY — sends --quote-only, no funds move.
// Inject a stub runner in tests so no live network call is ever made.
export function getQuote(
  params: QuoteParams,
  runner: QuoteRunner = defaultRunner,
): TwakQuote {
  const { amountIn, fromAsset, toAsset, chain = "bsc", slippagePct = 1 } = params;
  const args = `swap ${amountIn} ${fromAsset} ${toAsset} --chain ${chain} --slippage ${slippagePct} --quote-only --json`;
  return parseTwakJson(runner(args));
}

// ── Execution plan (pure) ─────────────────────────────────────────────────────

// PURE — builds the execute command args without spawning anything.
// --password <keychain> is a placeholder; the actual value is read from
// BNB_WALLET_PASSWORD at execution time and is never committed to source.
export function buildExecutePlan(
  params: QuoteParams,
  quote: TwakQuote | null,
  proposal: TradeProposal,
): ExecutionPlan {
  const { amountIn, fromAsset, toAsset, chain = "bsc", slippagePct = 1 } = params;
  const args = [
    "--yes",
    "--package",
    "@trustwallet/cli",
    "twak",
    "swap",
    String(amountIn),
    fromAsset,
    toAsset,
    "--chain",
    chain,
    "--slippage",
    String(slippagePct),
    "--password",
    "<keychain>",
    "--json",
  ];
  return { command: "npx", args, proposal, quote, dryRun: true };
}

// ── Execute ───────────────────────────────────────────────────────────────────

export type ExecuteMode = "dry-run" | "live";

// Build the audit-safe command string: <keychain> placeholder is shown as
// <redacted> so the real password is never written to any log or audit line.
function buildAuditCommand(plan: ExecutionPlan): string {
  const redacted = plan.args.map(arg => (arg === "<keychain>" ? "<redacted>" : arg));
  return `${plan.command} ${redacted.join(" ")}`;
}

// Parse the raw output from a live TWAK execute command.
// Tries common tx hash field names because the exact execute output shape is
// unconfirmed (no real swap has been run yet — docs/verify-in-docs.md §8).
// Also extracts amountOut/priceImpactPct/slippagePct using candidate field names
// matching the confirmed quote response shape (output, priceImpact, minReceived).
// All three are nullable — never fabricated; null when absent from stdout.
function parseLiveOutput(raw: string): {
  txHash?: string;
  error?: string;
  amountOut: number | null;
  priceImpactPct: number | null;
  slippagePct: number | null;
} {
  function toNum(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isNaN(n) ? null : n;
  }

  try {
    const obj = extractJson(raw);

    const txHash =
      typeof obj["txHash"] === "string" ? obj["txHash"] :
      typeof obj["hash"] === "string" ? obj["hash"] :
      typeof obj["transactionHash"] === "string" ? obj["transactionHash"] :
      undefined;
    const error = typeof obj["error"] === "string" ? obj["error"] : undefined;

    // amountOut: try execute-specific name first, then confirmed quote field name
    const amountOut = toNum(obj["amountOut"] ?? obj["output"]);

    // priceImpactPct: try both naming conventions
    const priceImpactPct = toNum(obj["priceImpactPct"] ?? obj["priceImpact"]);

    // slippagePct: try direct fields; if absent, derive from output vs minReceived
    let slippagePct: number | null = toNum(obj["slippagePct"] ?? obj["slippage"]);
    if (slippagePct === null && amountOut !== null && amountOut > 0) {
      const minReceived = toNum(obj["minReceived"]);
      if (minReceived !== null) {
        slippagePct = ((amountOut - minReceived) / amountOut) * 100;
      }
    }

    return { txHash, error, amountOut, priceImpactPct, slippagePct };
  } catch {
    return {
      error: `Unparseable TWAK execute output: ${raw.slice(0, 200)}`,
      amountOut: null,
      priceImpactPct: null,
      slippagePct: null,
    };
  }
}

// Internal gated live path — only called from execute("live", ...) after the
// gate and password checks pass. The real password is NEVER logged.
function executeLive(plan: ExecutionPlan, runner: LiveRunner): ExecutionResult {
  // 1. Hard environment gate — must be explicitly set to "yes"
  if (process.env["I_UNDERSTAND_REAL_FUNDS"] !== "yes") {
    throw new Error(
      "Live execution is gated: set I_UNDERSTAND_REAL_FUNDS=yes to enable. " +
      "Ensure the wallet is funded and BNB_WALLET_PASSWORD is set before proceeding.",
    );
  }

  // 2. Read the wallet password — never logged anywhere
  const password = process.env["BNB_WALLET_PASSWORD"];
  if (!password) {
    throw new Error(
      "BNB_WALLET_PASSWORD is required for live execution but is not set.",
    );
  }

  // 3. Audit log with password replaced by <redacted>
  console.log(`[veydrift live] executing: ${buildAuditCommand(plan)}`);

  // 4. Build real args: replace <keychain> placeholder with the actual password.
  //    realArgs are NEVER logged — they contain the plaintext password.
  const realArgs = plan.args.map(arg => (arg === "<keychain>" ? password : arg));

  // 5. Spawn via injectable runner
  let raw: string;
  try {
    raw = runner(plan.command, realArgs);
  } catch (err) {
    // execSync embeds the full command string in the error message when it fails.
    // That string contains the real --password value. Redact before persisting.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: msg.replace(/--password\s+\S+/g, "--password <redacted>"),
    };
  }

  // 6. Diagnostic: log full execute stdout when TWAK_DEBUG=yes (never on by default)
  if (process.env["TWAK_DEBUG"] === "yes") {
    console.log("[twak debug] raw execute stdout:", raw);
  }

  // 7. Parse output and return ExecutionResult
  const output = parseLiveOutput(raw);
  if (output.txHash) {
    return {
      ok: true,
      txHash: output.txHash,
      explorerUrl: `https://bscscan.com/tx/${output.txHash}`,
      amountOut: output.amountOut,
      priceImpactPct: output.priceImpactPct,
      slippagePct: output.slippagePct,
    };
  }
  return {
    ok: false,
    error: output.error ?? `No tx hash in TWAK execute output: ${raw.slice(0, 200)}`,
  };
}

// execute: overloaded so TypeScript infers the exact return type from the mode.
//
// "dry-run": logs the would-be command (password shown as <keychain>); returns
//            the plan unchanged — no spawn, no funds move, phase-3 behavior.
// "live":    GATED — throws immediately if I_UNDERSTAND_REAL_FUNDS !== "yes" or
//            BNB_WALLET_PASSWORD is unset; otherwise spawns via the injectable
//            runner and returns ExecutionResult. Inject a stub runner in tests.
export function execute(plan: ExecutionPlan, mode: "dry-run"): ExecutionPlan;
export function execute(plan: ExecutionPlan, mode: "live", runner?: LiveRunner): ExecutionResult;
export function execute(
  plan: ExecutionPlan,
  mode: ExecuteMode,
  runner: LiveRunner = defaultLiveRunner,
): ExecutionPlan | ExecutionResult {
  if (mode === "dry-run") {
    const cmd = [plan.command, ...plan.args].join(" ");
    console.log(`[veydrift dry-run] would execute: ${cmd}`);
    return plan;
  }
  return executeLive(plan, runner);
}
