import { describe, it, expect } from "vitest";
import {
  parseTwakJson,
  getQuote,
  buildExecutePlan,
  execute,
} from "../src/execution/twak.js";
import type { QuoteRunner, LiveRunner } from "../src/execution/twak.js";
import type { TradeProposal } from "@veydrift/shared";

// ── parseTwakJson ─────────────────────────────────────────────────────────────

const sampleJson = JSON.stringify({
  input: "5",
  output: "0.002886",
  minReceived: "0.002857",
  provider: "LiquidMesh",
  priceImpact: 0,
});

describe("parseTwakJson", () => {
  it("parses clean JSON", () => {
    const q = parseTwakJson(sampleJson);
    expect(q.provider).toBe("LiquidMesh");
    expect(q.input).toBe("5");
    expect(q.priceImpact).toBe(0);
  });

  it("tolerates a banner/preamble before the JSON (TWAK CLI writes one)", () => {
    const raw = `Trust Wallet Agent Kit v1.0\nInitializing...\n${sampleJson}`;
    const q = parseTwakJson(raw);
    expect(q.provider).toBe("LiquidMesh");
  });

  it("tolerates trailing noise after the JSON", () => {
    const raw = `${sampleJson}\n\nDone.`;
    const q = parseTwakJson(raw);
    expect(q.input).toBe("5");
  });

  it("throws when there is no JSON object in the output", () => {
    expect(() => parseTwakJson("no json here")).toThrow();
  });
});

// ── getQuote ──────────────────────────────────────────────────────────────────

describe("getQuote", () => {
  function captureRunner(returnJson: string): { runner: QuoteRunner; getArgs: () => string } {
    let captured = "";
    const runner: QuoteRunner = (args: string) => {
      captured = args;
      return returnJson;
    };
    return { runner, getArgs: () => captured };
  }

  it("calls the runner with the correct swap command args", () => {
    const stubJson = JSON.stringify({
      input: 10, output: 0.005, minReceived: 0.00495, provider: "TestProvider", priceImpact: 0,
    });
    const { runner, getArgs } = captureRunner(stubJson);

    const q = getQuote({ amountIn: 10, fromAsset: "USDT", toAsset: "ETH" }, runner);

    const calledWith = getArgs();
    expect(calledWith).toMatch(/^swap 10 USDT ETH/);
    expect(calledWith).toContain("--chain bsc");
    expect(calledWith).toContain("--slippage 1");
    expect(calledWith).toContain("--quote-only");
    expect(calledWith).toContain("--json");
    expect(q.provider).toBe("TestProvider");
  });

  it("uses default chain=bsc and slippage=1 when not specified", () => {
    const stubJson = JSON.stringify({
      input: 5, output: 0.002, minReceived: 0.00198, provider: "X", priceImpact: 0,
    });
    const { runner, getArgs } = captureRunner(stubJson);

    getQuote({ amountIn: 5, fromAsset: "ETH", toAsset: "USDT" }, runner);

    const args = getArgs();
    expect(args).toContain("--chain bsc");
    expect(args).toContain("--slippage 1");
  });

  it("passes through a custom chain and slippage", () => {
    const stubJson = JSON.stringify({ input: 1, output: 1, minReceived: 1, provider: "Y", priceImpact: 0 });
    const { runner, getArgs } = captureRunner(stubJson);

    getQuote({ amountIn: 1, fromAsset: "USDT", toAsset: "ETH", chain: "bnb", slippagePct: 0.5 }, runner);

    const args = getArgs();
    expect(args).toContain("--chain bnb");
    expect(args).toContain("--slippage 0.5");
  });
});

// ── buildExecutePlan ──────────────────────────────────────────────────────────

const baseProposal: TradeProposal = {
  fromAsset: "ETH",
  toAsset: "USDT",
  amountIn: 0.5,
  estimatedValueUsd: 1500,
  reason: "test rebalance",
  mode: "Neutral",
  R: 0.5,
};

const baseQuote = {
  input: 0.5,
  output: 1500,
  minReceived: 1485,
  provider: "LiquidMesh",
  priceImpact: 0.1,
};

describe("buildExecutePlan", () => {
  it("returns a plan without spawning anything", () => {
    const plan = buildExecutePlan(
      { amountIn: 0.5, fromAsset: "ETH", toAsset: "USDT" },
      baseQuote,
      baseProposal,
    );
    expect(plan.command).toBe("npx");
    expect(plan.args).toContain("twak");
    expect(plan.args).toContain("swap");
    expect(plan.dryRun).toBe(true);
    expect(plan.proposal).toBe(baseProposal);
    expect(plan.quote).toBe(baseQuote);
  });

  it("includes --password <keychain> placeholder — no real password", () => {
    const plan = buildExecutePlan(
      { amountIn: 0.5, fromAsset: "ETH", toAsset: "USDT" },
      baseQuote,
      baseProposal,
    );
    const idx = plan.args.indexOf("--password");
    expect(idx).toBeGreaterThan(-1);
    expect(plan.args[idx + 1]).toBe("<keychain>");
  });

  it("does NOT include --quote-only (that flag is for getQuote, not execute)", () => {
    const plan = buildExecutePlan(
      { amountIn: 0.5, fromAsset: "ETH", toAsset: "USDT" },
      baseQuote,
      baseProposal,
    );
    expect(plan.args).not.toContain("--quote-only");
  });

  it("stores a null quote when no quote is available (e.g. kill-switch path)", () => {
    const plan = buildExecutePlan(
      { amountIn: 0.5, fromAsset: "ETH", toAsset: "USDT" },
      null,
      baseProposal,
    );
    expect(plan.quote).toBeNull();
  });
});

// ── execute (dry-run) ─────────────────────────────────────────────────────────

describe("execute dry-run", () => {
  const plan = buildExecutePlan(
    { amountIn: 0.5, fromAsset: "ETH", toAsset: "USDT" },
    baseQuote,
    baseProposal,
  );

  it("returns the plan unchanged (same reference)", () => {
    const result = execute(plan, "dry-run");
    expect(result).toBe(plan);
  });
});

// ── execute — gated live path (Phase 4) ──────────────────────────────────────

describe("execute live — gated path", () => {
  const plan = buildExecutePlan(
    { amountIn: 0.5, fromAsset: "ETH", toAsset: "USDT" },
    baseQuote,
    baseProposal,
  );

  // Save and restore env vars around each test that touches them
  function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    try {
      fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  }

  it("throws gate refusal when I_UNDERSTAND_REAL_FUNDS is unset", () => {
    withEnv({ I_UNDERSTAND_REAL_FUNDS: undefined }, () => {
      expect(() => execute(plan, "live")).toThrow(/I_UNDERSTAND_REAL_FUNDS/);
    });
  });

  it("throws gate refusal when I_UNDERSTAND_REAL_FUNDS is 'no'", () => {
    withEnv({ I_UNDERSTAND_REAL_FUNDS: "no" }, () => {
      expect(() => execute(plan, "live")).toThrow(/I_UNDERSTAND_REAL_FUNDS/);
    });
  });

  it("throws when BNB_WALLET_PASSWORD is missing even with gate set", () => {
    withEnv(
      { I_UNDERSTAND_REAL_FUNDS: "yes", BNB_WALLET_PASSWORD: undefined },
      () => {
        expect(() => execute(plan, "live", () => "")).toThrow(/BNB_WALLET_PASSWORD/);
      },
    );
  });

  it("gate ON + stub runner returning txHash → ok:true with txHash and explorerUrl", () => {
    const fakeHash = "0xdeadbeef0000000000000000000000000000000000000001";
    const stubRunner: LiveRunner = () => JSON.stringify({ txHash: fakeHash });

    withEnv(
      { I_UNDERSTAND_REAL_FUNDS: "yes", BNB_WALLET_PASSWORD: "test-pw" },
      () => {
        const result = execute(plan, "live", stubRunner);
        expect(result.ok).toBe(true);
        expect(result.txHash).toBe(fakeHash);
        expect(result.explorerUrl).toBe(`https://bscscan.com/tx/${fakeHash}`);
      },
    );
  });

  it("<keychain> placeholder is replaced with real password in spawned args", () => {
    let capturedCommand = "";
    let capturedArgs: string[] = [];
    const capturingRunner: LiveRunner = (cmd, args) => {
      capturedCommand = cmd;
      capturedArgs = [...args];
      return JSON.stringify({ txHash: "0xabc" });
    };

    withEnv(
      { I_UNDERSTAND_REAL_FUNDS: "yes", BNB_WALLET_PASSWORD: "secret-pw" },
      () => {
        execute(plan, "live", capturingRunner);
        expect(capturedCommand).toBe("npx");
        const pwIdx = capturedArgs.indexOf("--password");
        expect(pwIdx).toBeGreaterThan(-1);
        // Placeholder must be replaced with the real password in the spawned args
        expect(capturedArgs[pwIdx + 1]).toBe("secret-pw");
        // <keychain> must NOT appear — it must have been replaced
        expect(capturedArgs).not.toContain("<keychain>");
      },
    );
  });

  it("audit log contains <redacted> and NEVER the real password", () => {
    const realPassword = "ultra-secret-pw-must-not-appear-in-logs";
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };

    const stubRunner: LiveRunner = () => JSON.stringify({ txHash: "0xabc" });

    withEnv(
      { I_UNDERSTAND_REAL_FUNDS: "yes", BNB_WALLET_PASSWORD: realPassword },
      () => {
        try {
          execute(plan, "live", stubRunner);
        } finally {
          console.log = origLog;
        }
        const fullLog = logs.join("\n");
        expect(fullLog).toContain("<redacted>");
        expect(fullLog).not.toContain(realPassword);
      },
    );
  });

  it("runner throwing returns ok:false with error message, no crash", () => {
    const errorRunner: LiveRunner = () => {
      throw new Error("TWAK NETWORK_ERROR: swap failed");
    };

    withEnv(
      { I_UNDERSTAND_REAL_FUNDS: "yes", BNB_WALLET_PASSWORD: "test-pw" },
      () => {
        const result = execute(plan, "live", errorRunner);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/NETWORK_ERROR/);
        expect(result.txHash).toBeUndefined();
      },
    );
  });

  it("runner returning TWAK error JSON → ok:false with the error text", () => {
    const errorJsonRunner: LiveRunner = () =>
      JSON.stringify({ error: "Insufficient balance for swap" });

    withEnv(
      { I_UNDERSTAND_REAL_FUNDS: "yes", BNB_WALLET_PASSWORD: "test-pw" },
      () => {
        const result = execute(plan, "live", errorJsonRunner);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/Insufficient balance/);
      },
    );
  });

  it("execute stdout with swap fields → amountOut/priceImpactPct/slippagePct populated", () => {
    // Simulate TWAK execute returning the same fields as a quote response
    const swapOutput = JSON.stringify({
      txHash: "0xdeadbeef0000000000000000000000000000000000000002",
      output: "0.001147",
      priceImpact: 0.05,
      minReceived: "0.001135",
    });
    const stubRunner: LiveRunner = () => swapOutput;

    withEnv(
      { I_UNDERSTAND_REAL_FUNDS: "yes", BNB_WALLET_PASSWORD: "test-pw" },
      () => {
        const result = execute(plan, "live", stubRunner);
        expect(result.ok).toBe(true);
        expect(result.amountOut).toBeCloseTo(0.001147);
        expect(result.priceImpactPct).toBeCloseTo(0.05);
        // slippagePct derived from (output - minReceived) / output * 100
        expect(result.slippagePct).not.toBeNull();
        expect(result.slippagePct!).toBeGreaterThan(0);
      },
    );
  });

  it("execute stdout without swap fields → amountOut/priceImpactPct/slippagePct are null", () => {
    const stubRunner: LiveRunner = () =>
      JSON.stringify({ txHash: "0xdeadbeef0000000000000000000000000000000000000003" });

    withEnv(
      { I_UNDERSTAND_REAL_FUNDS: "yes", BNB_WALLET_PASSWORD: "test-pw" },
      () => {
        const result = execute(plan, "live", stubRunner);
        expect(result.ok).toBe(true);
        expect(result.amountOut).toBeNull();
        expect(result.priceImpactPct).toBeNull();
        expect(result.slippagePct).toBeNull();
      },
    );
  });
});
