# Veydrift — Architecture

How Veydrift is structured: layers, data flow, loop, guardrails.
Read alongside docs/plan.md.

---

## 1. Layered design

Each layer has one job. The separation is deliberate and must be preserved.

**Perception layer: Bitget Skill Hub**
- 5 skills: technical-analysis, sentiment-analyst, macro-analyst, market-intel, news-briefing
- Provides: RSI, trend, sentiment, Fear & Greed equivalent, funding rates, macro signals
- Replaces: CMC Agent Hub (used in Keel)

**Risk engine: deterministic formula**
- Same 3-component formula as Keel (see docs/risk-policy.md)
- Pure function, no I/O, no LLM
- Protected file: `packages/agent/src/risk/engine.ts` — never modify

**Post-formula overlays: additive only**
- Regime-bias, TA-caution, macro-event de-risk
- Feed from Bitget Skill Hub signals

**Guardrail chain:**
```
Kill-switch → Allowlist → Per-trade cap → Daily-loss cap
→ Slippage → Asymmetric projected-drawdown gate
```

**Execution layer: Bitget MCP server**
- Tool: `spot_place_order` (replaces TWAK swap)
- Auth: `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE`
- Paper trading: `--paper-trading` flag (requires Demo API key)
- Balance reading: `get_account_assets`
- Fill history: `spot_get_fills`
- Status: PENDING (not yet built)

**State and audit:**
- Same persistence pattern as Keel
- `agent-state.json`, `audit.jsonl`
- Deployed to Railway with persistent volume

**Dashboard:**
- Next.js 15, TypeScript, Tailwind, Recharts
- Same component structure as Keel
- Rebranding to Veydrift: PENDING

---

## 2. The loop

1. Perceive — fetch signals from Bitget Skill Hub (5 skills)
2. Score risk → R
3. Select mode + target volatile exposure
4. Compare to current holdings; decide buy/sell/rebalance/hold
5. Run guardrail chain
6. If trade warranted: call Bitget MCP `spot_place_order`
7. Log decision, reason, Bitget order ID (proof)
8. Sleep until next cycle. At least one action per qualifying period.

---

## 3. Guardrails

Same 5 guardrails as Keel:

| Guardrail | Purpose |
|---|---|
| Trading pair allowlist | Only BTCUSDT, ETHUSDT on Bitget spot |
| Per-trade cap | Limits size of any single order |
| Daily-loss cap | Halts new risk-taking after threshold |
| Slippage limit | Rejects order if fill price exceeds tolerance |
| Max-drawdown kill-switch | Rotates to USDT on breach. Never to zero. |

---

## 4. Credentials model

- API key, secret key, passphrase stored as Railway env vars
- Never logged, never committed, redacted in all audit output
- No private key involved (CEX account, not self-custody)

---

## 5. Repo structure

```
veydrift/
  apps/
    web/          — dashboard (Next.js + TypeScript + Tailwind)
  packages/
    agent/
      src/
        risk/
          engine.ts        ← PROTECTED. Never modify.
        loop/
          cycle.ts         ← PROTECTED. Never modify.
          gate.ts          ← PROTECTED. Never modify.
        perception/
          bitget-skills.ts ← PENDING. Replace CMC perception.
        execution/
          bitget.ts        ← PENDING. Replace TWAK execution.
        runner.ts          ← Adapt for Bitget balance reading.
    shared/       — TypeScript types (shared by agent + web)
  docs/           — these documents
  server.js       — Railway entrypoint
```

---

## 6. What was removed from Keel

The following Keel components do not exist in Veydrift:
- TWAK (Trust Wallet Agent Kit) — replaced by Bitget MCP
- CMC (CoinMarketCap) — replaced by Bitget Skill Hub
- BSC / BNB Chain — replaced by Bitget CEX spot account
- x402 — not applicable
- BNB Agent SDK — not applicable
- On-chain registration — not applicable
- keel.cjs prototype — not applicable
