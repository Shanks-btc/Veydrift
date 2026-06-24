# Veydrift — Plan (Source of Truth)

This document is the canonical reference for what Veydrift is, how it
behaves, and what has actually been built and verified.

Core rule: do not guess, do not hallucinate, do not mark something
verified unless it was actually tested successfully in practice.
Anything not yet exercised is labelled honestly (PENDING, NOT YET
TESTED, or PARTIAL).

---

## 1. Product definition

Veydrift is an autonomous spot trading agent on Bitget CEX.

It reads live market signals from the Bitget Skill Hub, computes a
deterministic 3-component risk score, and rotates a spot portfolio
between volatile and stable assets via the Bitget MCP server. Every
cycle's reasoning is persisted to an audit log. The trading decision
is fully deterministic — no LLM in the loop.

---

## 2. Trading model — SPOT ONLY (hard constraint)

Veydrift is a spot-rotation agent. This is permanent.

**Allowed:** spot order, buy, sell, rebalance, hold, spot holdings,
portfolio allocation, exposure, volatile allocation, stable allocation,
latest order, order route, order ID, proof trail.

**Forbidden — never appear in code, data, or UI:**
- PERP / perpetuals / futures
- leverage / margin
- long / short
- entry price / mark price / liquidation
- order book
- any leveraged-trading language

---

## 3. Trading pairs (allowlist)

Bitget spot pairs only:
- Volatile: BTCUSDT, ETHUSDT
- Stable: USDT (quote currency)

BNB, BSC tokens, and BEP-20 tokens are NOT applicable.

---

## 4. Architecture summary

Full detail in docs/architecture.md.

- Bitget Skill Hub: perception layer (5 skills)
- Risk engine: deterministic formula (unchanged from Keel, PROTECTED)
- Bitget MCP server: sole execution layer (PENDING)
- Guardrails: same 5 as Keel (allowlist, per-trade cap, daily-loss cap,
  slippage, max-drawdown kill-switch)
- Railway: deployment platform
- Next.js dashboard: same structure as Keel, rebranding PENDING

---

## 5. Risk engine (confirmed, unchanged from Keel)

```
R = clamp01(
  min(1, |change_1h| / 3) * 0.40
  + min(1, |change_24h| / 10) * 0.40
  + max(0, (fearGreed - 60) / 40) * 0.20
)
```

| R range | Mode | Target volatile exposure |
|---|---|---|
| R < 0.33 | Risk-on | ~80% |
| 0.33–0.66 | Neutral | ~45% |
| R >= 0.66 | Risk-off | ~18% (never 0) |

The UI displays only these three components (1h change, 24h change,
Fear & Greed equivalent from Bitget Skill Hub). No other components.

---

## 6. Build status

**DONE (inherited from Keel, verified):**
- Risk engine (`engine.ts`) — 293 tests passing
- Guardrail chain (`gate.ts`) — tested
- Core cycle (`cycle.ts`) — tested
- Dashboard components — all built, need rebranding
- State persistence — working

**PENDING (not yet built):**
- `packages/agent/src/perception/bitget-skills.ts`
  Replace CMC perception with Bitget Skill Hub calls
- `packages/agent/src/execution/bitget.ts`
  Replace TWAK execution with Bitget MCP `spot_place_order`
- `runner.ts` adaptation for Bitget balance reading
  (currently reads from env vars; needs `get_account_assets`)
- Dashboard rebranding (Keel → Veydrift, BSC → Bitget)
- Live trading log from Bitget
- Python Playbook backtest (`getagent-skill` v0.3.3 installed)

---

## 7. Next steps (ordered)

1. Replace perception layer:
   Create `packages/agent/src/perception/bitget-skills.ts`.
   Calls Bitget Skill Hub to get RSI (technical-analysis),
   Fear & Greed equivalent (sentiment-analyst), macro signals
   (macro-analyst). Maps outputs to the same signal shape the
   risk engine expects.

2. Replace execution layer:
   Create `packages/agent/src/execution/bitget.ts`.
   Calls Bitget MCP `spot_place_order` for spot orders.
   Reads `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE`
   from env. Redacts credentials in all audit output.

3. Adapt `runner.ts`:
   Replace TWAK balance reading with `get_account_assets` call.
   Keep all other runner logic identical.

4. Dashboard rebranding:
   Change "Keel" to "Veydrift" throughout.
   Change "BNB Chain" to "Bitget".
   Remove BSC tx hash references.
   Add Bitget order ID as proof.

5. Deploy to Railway and verify live cycle.

6. Generate trading log from live cycles.

7. Python Playbook backtest (supplementary evidence).

---

## 8. Environment (confirmed)

- OS: Windows
- Node: v24.14.0
- Python: 3.14.5
- Package manager: npm workspaces (do NOT switch to pnpm)
- Bitget MCP server: v1.1.0 installed globally
- getagent-skill: v0.3.3 installed globally
- Bitget API: confirmed reachable from Railway servers
  (blocked locally in UK — always test from Railway)

---

## 9. Hard rules

- Risk engine (`engine.ts`), `cycle.ts`, `gate.ts`: NEVER MODIFY.
- Spot-only vocabulary everywhere (see §2).
- Never drain to zero; risk-off → USDT, not zero balance.
- Credentials (API key, secret, passphrase) never appear in
  logs, audit output, error messages, or committed files.
- Do not mark anything verified that was not actually run.
