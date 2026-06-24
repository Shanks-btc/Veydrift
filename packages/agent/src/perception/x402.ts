// x402 integration — optional, ONE rationed in-loop payment via TWAK CLI.
//
// Rules:
//   • Gated behind X402_ENABLED=yes. Off by default.
//   • Settlement: USDC on Base (Chain ID 8453).
//   • Proof is STRICTLY SEPARATE from BSC trade proof. Never conflate the two.
//   • If the call fails, log the failure and return ok:false. Never throws.
//   • Must not block daily qualifying attempt (non-critical path).

import { execSync } from "child_process";
import type { X402PaymentProof } from "@veydrift/shared";

// ── Runner type ───────────────────────────────────────────────────────────────

// Injectable runner for TWAK x402 commands.
// (args: string) → raw CLI output string
// Default runner uses execSync; tests inject a stub.
export type X402Runner = (args: string) => string;

const defaultX402Runner: X402Runner = (args: string) =>
  execSync(`npx --yes --package @trustwallet/cli twak ${args}`, {
    encoding: "utf8",
    timeout: 60_000, // x402 on-chain settlement can take several seconds
  });

// ── Feature flag ──────────────────────────────────────────────────────────────

export function isX402Enabled(): boolean {
  return process.env["X402_ENABLED"] === "yes";
}

function getX402Url(): string | undefined {
  return process.env["X402_URL"];
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface X402PaymentResult {
  ok: boolean;
  proof?: X402PaymentProof; // set when ok:true and a Base tx hash was confirmed
  error?: string;           // set when ok:false
}

// ── Output parsing ────────────────────────────────────────────────────────────

// Parse the raw TWAK x402 request output into an X402PaymentProof.
// Returns null when no tx hash can be found.
function parseX402Output(raw: string, url: string): X402PaymentProof | null {
  try {
    const i = raw.indexOf("{");
    const j = raw.lastIndexOf("}");
    if (i === -1 || j === -1) return null;
    const obj = JSON.parse(raw.slice(i, j + 1)) as {
      txHash?: string;
      hash?: string;
      transactionHash?: string;
      amount?: string | number;
      amountPaid?: string | number;
    };
    const txHash = obj.txHash ?? obj.hash ?? obj.transactionHash;
    if (!txHash) return null;
    // amount is in atomic USDC units (6 decimals): 10000 → 0.01 USDC
    const rawAmount = obj.amount ?? obj.amountPaid ?? 10_000;
    const atomicAmount = typeof rawAmount === "number"
      ? rawAmount
      : parseFloat(String(rawAmount));
    const amountUsdc = isNaN(atomicAmount) ? 0.01 : atomicAmount / 1_000_000;
    return {
      txHash,
      chain: "Base",
      chainId: 8453,
      amountUsdc,
      settledAt: new Date().toISOString(),
      url,
      explorerUrl: `https://basescan.org/tx/${txHash}`,
    };
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

// Attempt one x402 payment for Hub access.
// Returns immediately with ok:false when x402 is disabled.
// On any failure (network, signing, timeout): logs + returns ok:false.
// Never throws; never blocks trading.
export function attemptX402(
  url: string,
  maxPaymentAtomicUsdc = 10_000, // 0.01 USDC at 6 decimals
  runner: X402Runner = defaultX402Runner,
): X402PaymentResult {
  if (!isX402Enabled()) {
    return { ok: false, error: "x402 disabled (X402_ENABLED not set to yes)" };
  }
  const args = [
    "x402",
    "request",
    url,
    "--prefer-network",
    "base",
    "--max-payment",
    String(maxPaymentAtomicUsdc),
    "--yes",
    "--json",
  ].join(" ");

  try {
    const raw = runner(args);
    const proof = parseX402Output(raw, url);
    if (!proof) {
      const msg = `x402: no tx hash in output: ${raw.slice(0, 200)}`;
      console.warn(`[veydrift x402] ${msg}`);
      return { ok: false, error: msg };
    }
    // Log Base tx hash — strictly separate from BSC trade hashes
    console.log(`[veydrift x402] Base payment confirmed — ${proof.txHash} (${proof.amountUsdc} USDC)`);
    return { ok: true, proof };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[veydrift x402] payment failed — proceeding without: ${msg}`);
    return { ok: false, error: msg };
  }
}

// Attempt x402 using the configured X402_URL from the environment.
// Convenience wrapper for in-loop use.
export function attemptX402FromEnv(
  runner: X402Runner = defaultX402Runner,
): X402PaymentResult {
  const url = getX402Url();
  if (!url) {
    return { ok: false, error: "x402 disabled (X402_URL not set)" };
  }
  return attemptX402(url, 10_000, runner);
}
