# Veydrift
### Autonomous SPOT Trading Agent — Bitget

Veydrift reads live market signals from the Bitget Skill Hub, computes a transparent 3-component risk score, and rotates a spot portfolio between volatile and stable assets via the Bitget MCP server. The trading decision is fully deterministic — no LLM in the loop, fully auditable and reproducible. Every cycle's reasoning is persisted to an audit log and shown live on the dashboard.

## Live Links

[Placeholders — fill after deployment]
- Live Dashboard: PENDING
- GitHub: https://github.com/Shanks-btc/Veydrift
- Trading Log: PENDING

---

## Architecture

| Layer | Technology |
|---|---|
| Perception | Bitget Skill Hub (5 skills) |
| Risk Engine | Deterministic 3-component formula (no LLM) |
| Execution | Bitget MCP server (spot_place_order) |
| State/Audit | JSON persistence, audit log |
| Dashboard | Next.js 15, TypeScript, Tailwind, Recharts |
| Deployment | Railway |

---

## Risk Engine Formula

```
R = clamp01(
  min(1, |Δ1h| / 3) × 0.4
  + min(1, |Δ24h| / 10) × 0.4
  + max(0, (FearGreed - 60) / 40) × 0.2
)

Risk-on  (R < 0.33) → 80% volatile target
Neutral  (R < 0.66) → 45% volatile target
Risk-off (R ≥ 0.66) → 18% volatile target (never 0)
```

Deterministic. No LLM in the trading decision — fully reproducible from the same three inputs every time.

---

## Trading Pairs

Spot only. BTCUSDT and ETHUSDT on Bitget.
No perps, futures, leverage, long/short, or liquidation.

---

## Protected Files (never modify)

- `packages/agent/src/risk/engine.ts`
- `packages/agent/src/loop/cycle.ts`
- `packages/agent/src/loop/gate.ts`

---

## Setup

[PENDING — fill after execution layer is built]

---

## Build Status

- Risk engine: inherited from Keel, unchanged, 293 tests passing
- Execution layer (bitget.ts): PENDING
- Perception layer (bitget-skills.ts): PENDING
- Dashboard rebranding: PENDING
- Live trading log: PENDING

---

## How Honesty Is Enforced, By Design

Veydrift's dashboard never shows a fake number. Every card has an explicit, honest empty state rather than a placeholder dressed up as real data. The agent's own self-reporting logs `BLOCKED` with the exact reason when a cycle does not execute — it never fabricates a success.

---

## Disclaimers

This is not investment advice. The agent trades real Bitget spot assets autonomously, within a small, intentionally limited budget. Losses are possible. Veydrift will not trade pairs outside its allowlist (BTCUSDT, ETHUSDT), will not submit orders outside the Bitget MCP server, and will not bypass its guardrail chain.

---

## License

MIT — see [LICENSE](./LICENSE) for details.
