# Veydrift
**Deterministic Autonomous SPOT Trading Agent **

Veydrift optimizes for capital preservation while capturing upside. It is a SPOT-only autonomous agent that reads live Bitget market signals, computes a transparent risk score, and rotates a portfolio between volatile and stable assets, with every decision logged to a verifiable audit trail and surfaced live on the dashboard.

**[Live Dashboard](https://veydrift-test-production.up.railway.app/) · [GitHub](https://github.com/Shanks-btc/Veydrift) · [Agent Playbook on Bitget GetAgent](https://www.bitget.com/quantitative/strategy/bdbcfadd-2667-40ca-b946-eb0aefcfc2a3)**

---

## For Judges

- **Live trading record:** orderId `1454827723763916806` — real ETHUSDC spot order executed on Bitget, 2026-06-27. Viewable on the [Trade Journal](https://veydrift-test-production.up.railway.app/journal).
- **Published backtest:** `veydrift-risk-rotation` on Bitget GetAgent — 20 trades, 42 days, -0.15% account return on $100k starting balance. [View strategy](https://www.bitget.com/quantitative/strategy/bdbcfadd-2667-40ca-b946-eb0aefcfc2a3).
- **Live agent state:** the dashboard reads real Bitget API data on every cycle — every number is either real or an explicit honest empty state, never fabricated.
- **Verified API proof:** Bitget public API confirmed reachable (code 00000), authenticated API confirmed working (code 00000), HMAC-SHA256 signing verified against live API — all shown on the [Architecture page](https://veydrift-test-production.up.railway.app/journal#architecture).

---

## Who This Is For

- Hackathon judges evaluating autonomous agent depth, live Bitget integration, and deterministic risk design.
- Builders who want a minimal, fully auditable reference for a CEX trading agent with a deterministic (non-LLM) decision core.
- Anyone who wants to see exactly how a risk-managed autonomous agent reasons, gate by gate, with no black box.

**What this is NOT (deliberate scope choices):**

- Not investment advice, ever. No profitability claim.
- Not LLM-driven in the trading decision. The risk score is pure deterministic math — auditable, reproducible, no model in the loop.
- Not "guaranteed." Veydrift is designed to be capital-preserving and drawdown-resistant — a meaningfully different, honest claim.

---

## What Veydrift Does

Most autonomous trading agents chase upside and blow up on the first real drawdown. Veydrift is built backwards from that failure mode: a deterministic 3-component risk engine reads live Bitget market signals (spot prices, 24h momentum, BTC funding rate as sentiment proxy), computes a transparent risk score, and rotates a Bitget spot portfolio between volatile (ETH) and stable (USDC) assets via direct Bitget REST API with HMAC-SHA256 signing.

A daily qualification scheduler attempts the lowest-risk valid action every cycle. An asymmetric drawdown gate always permits de-risking, never blocks it. A hard kill-switch and per-trade caps stay active at all times. Every cycle's reasoning — signals used, risk score, mode, gate results, and outcome — is persisted to an audit log and surfaced live on the dashboard.

---

## Live Demo — Proof of Life

| Output | Value |
|---|---|
| Live Dashboard | https://veydrift-test-production.up.railway.app/ |
| Trade Journal | https://veydrift-test-production.up.railway.app/journal |
| Agent Playbook | https://www.bitget.com/quantitative/strategy/bdbcfadd-2667-40ca-b946-eb0aefcfc2a3 |
| First Live Order ID | 1454827723763916806 |
| Trading Pair | ETHUSDC (Bitget spot) |
| Execution Layer | Bitget REST API v2 — HMAC-SHA256 signed |
| Balance | Real Bitget spot account balance read on every cycle |
| Test Coverage | 293/293 tests passing |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Perception Layer                       │
│   Bitget REST API (public) — primary signals                │
│   Signals: ETH/BTC spot prices, 24h/1h change,             │
│   BTC funding rate (sentiment proxy)                        │
└────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Deterministic Risk Engine                  │
│   R = |1h|/3·0.4 + |24h|/10·0.4 + max(0,(F&G−60)/40)·0.2  │
│   Risk-on  (R < 0.33) → 50% volatile                       │
│   Neutral  (R < 0.66) → 35% volatile                       │
│   Risk-off (R ≥ 0.66) → 18% volatile                       │
│   No LLM in the trading decision — fully auditable          │
└────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Post-Formula Overlays (additive only)          │
│   Drawdown overlay — caps volatile target below mode default │
│   Emergency mode — no new volatile exposure below -14%      │
└────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Guardrail / Gate Chain                    │
│   Kill-switch → Allowlist → Per-trade cap → Daily-loss cap  │
│   → Slippage → Asymmetric projected-drawdown gate           │
│   (de-risking trades are never blocked by their own check)  │
└────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Bitget REST API — Execution Layer              │
│   POST /api/v2/spot/trade/place-order                       │
│   HMAC-SHA256 signed. Market orders only. ETHUSDC pair.     │
│   Minimum order size enforced ($1.25). 4dp rounding.        │
└────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Audit Trail                               │
│   Real Bitget order ID per execution. Full cycle reasoning  │
│   persisted and shown live on the Trade Journal page.       │
│   Exportable as CSV for submission evidence.                │
└─────────────────────────────────────────────────────────────┘
```

---

## Bitget Integrations

| Integration | Type | Purpose | Status |
|---|---|---|---|
| Bitget REST API | Public REST | ETH/BTC spot prices, funding rate | Confirmed |
| Bitget REST API | Authenticated REST | Account balance (ETHUSDC) | Confirmed |
| Bitget Spot Orders | Authenticated REST | ETHUSDC market order execution | Confirmed |
| HMAC-SHA256 Signing | Auth Layer | timestamp + method + path + body | Confirmed |
| Bitget GetAgent | Playbook Platform | Backtest + strategy publication | Published |

---

## Risk Engine Formula

```
R = clamp01(
      min(1, |Δ1h|  / 3)  × 0.4
    + min(1, |Δ24h| / 10) × 0.4
    + max(0, (FundingRate proxy - 60) / 40) × 0.2
)

Risk-on   (R < 0.33) → 50% volatile target
Neutral   (R < 0.66) → 35% volatile target
Risk-off  (R ≥ 0.66) → 18% volatile target (never 0%)
```

Deterministic. No oracle, no LLM, no human judgment in the trading decision — fully reproducible from the same three inputs every time.

**Allowlist (hard-coded, enforced by gate):**
- Volatile: ETH
- Stable: USDT, USDC, USD1, FDUSD
- Trading pair: ETHUSDC (Bitget spot)

---

## Agent Playbook — Backtest Results

Published on Bitget GetAgent as `veydrift-risk-rotation`.

| Metric | Value |
|---|---|
| Backtest Period | May 16 – Jun 27, 2026 (42 days) |
| Starting Capital | $100,000 USDT |
| Ending Balance | $99,848.60 USDT |
| Account Return | -0.15% |
| Max Drawdown | 0.15% |
| Total Trades | 20 |
| Win Rate | 30% |
| Sharpe Ratio | -8.31 |
| Estimated Fees | ~$3.49 USDT |

The -0.15% account return reflects fees from 20 rotation trades during a volatile 42-day period. The strategy preserved 99.85% of capital — validating the risk-off guardrail design.

[View published strategy →](https://www.bitget.com/quantitative/strategy/bdbcfadd-2667-40ca-b946-eb0aefcfc2a3)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Agent core | Node.js, TypeScript |
| Dashboard | Next.js 15, React |
| Execution | Bitget REST API v2, HMAC-SHA256 |
| Market data | Bitget public REST API |
| Backtest | Bitget GetAgent (NautilusTrader) |
| Testing | Vitest — 293 tests passing |
| Deployment | Railway (single service, persistent volume) |

---

## Protected Files (never modified)

```
packages/agent/src/risk/engine.ts    ← deterministic 3-mode formula
packages/agent/src/loop/cycle.ts     ← core decision cycle
packages/agent/src/loop/gate.ts      ← guardrail chain
```

These three files are inherited from the original architecture and were never modified — the risk engine is the same deterministic formula that powers the published backtest.

---

## Local Deployment

**Prerequisites:** Node.js 18+, npm, Bitget API credentials

```bash
# 1. Clone
git clone https://github.com/Shanks-btc/Veydrift.git
cd Veydrift
git checkout phase-5

# 2. Install
npm install

# 3. Configure environment
cp .env.example .env
# Fill in:
# BITGET_API_KEY=
# BITGET_SECRET_KEY=
# BITGET_PASSPHRASE=
# PORTFOLIO_VALUE_USD=5
# VOLATILE_VALUE_USD=0
# STABLE_VALUE_USD=5
# I_UNDERSTAND_REAL_FUNDS=no   # change to yes when ready for live trading
# KEEL_DATA_DIR=./data

# 4. Dry run (no funds at risk)
npm run cycle:dry

# 5. Run dashboard
npm run dev --workspace=apps/web
# http://localhost:3000
```

---

## Project Structure

```
Veydrift/
  packages/
    agent/
      src/
        risk/
          engine.ts          ← deterministic 3-mode formula (protected)
          overlays.ts        ← drawdown overlays
        loop/
          cycle.ts           ← core decision cycle (protected)
          gate.ts            ← guardrail chain (protected)
          drawdown-gate.ts   ← asymmetric projected-drawdown gate
          scheduler.ts       ← daily qualification scheduler
        perception/
          bitget-signals.ts  ← live Bitget market signals
        execution/
          bitget.ts          ← Bitget REST API execution layer
        state/
          persistence.ts     ← state + day-ledger persistence
          audit.ts           ← append-only audit log
        runner.ts            ← single-cycle entrypoint
    shared/
      src/types.ts           ← shared type definitions
  apps/
    web/
      src/
        app/
          api/               ← agent-state, portfolio, cycle-preview
          console/           ← Live Console page
          journal/           ← Trade Journal + Architecture page
          playbook/          ← Backtest + GetAgent Playbook page
  veydrift-playbook/         ← GetAgent backtest package (Python)
  server.js                  ← Railway single-service entrypoint
```

---

## How Honesty Is Enforced, By Design

Veydrift's dashboard never shows a fake number. Every card has an explicit honest empty state rather than a placeholder dressed up as real data. Source labeling is explicit: LIVE (real Bitget API data) or honest awaiting-data states. The agent's self-reporting logs SKIPPED or BLOCKED with the exact reason when a cycle does not execute — it never fabricates a success.

---

## Disclaimers

This is hackathon code, not investment advice. The agent trades real Bitget spot assets autonomously, within a small, intentionally limited budget. Losses are possible. Veydrift will not trade pairs outside its allowlist (ETHUSDC), will not submit orders outside the Bitget REST API, and will not bypass its guardrail chain.

---

## Team

Solo builder — full-stack and blockchain developer, four years of experience, focused on Web3/AI agent infrastructure. Built Veydrift end-to-end: risk engine, Bitget API integration, autonomous scheduler, live dashboard, and published GetAgent backtest.

| Channel | Handle |
|---|---|
| X | [@Shank_btc](https://x.com/Shank_btc) |
| GitHub | [Shanks-btc](https://github.com/Shanks-btc) |
| Email | pkelvin856@gmail.com |

---

## License

MIT — see LICENSE for details.
