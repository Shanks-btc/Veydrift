# Veydrift — Demo Script

A clear end-to-end walkthrough of Veydrift as a product. Goal: in
the first ten seconds a viewer understands what it is, that it is
actively trading, and that every action is real and provable.

---

## 0. One-line framing

> "Veydrift is an autonomous spot trading agent that rotates a Bitget
> portfolio between volatile and stable assets based on a transparent,
> deterministic risk score — and every decision is logged with proof."

---

## 1. The ten-second read (open on the dashboard)

Point to the summary row:

- **Portfolio Value** — total USD value from Bitget account
- **PnL** — change since first live snapshot
- **Current Exposure** — volatile vs stable split
- **Latest Order** — most recent autonomous action (e.g. BTCUSDT buy)
- **Current Drawdown** — within the guardrail limit

Top bar: status Running, current mode (Risk-on/Neutral/Risk-off),
last updated time.

---

## 2. "It's actively trading"

- **Portfolio Allocation** donut — live split across BTCUSDT, ETHUSDT, USDT
- **Spot Holdings** table — each asset, role, balance, USD value, alloc %,
  24h change

---

## 3. "Here's why it acted"

- **Market Signals** — from Bitget Skill Hub: sentiment, 1h/24h change,
  technical indicators
- **Risk Score Breakdown** — three components (1h change, 24h change,
  sentiment/Fear & Greed equivalent) and resulting score with risk label

Message: the mode is a transparent function of live Bitget signals,
not a black box or an LLM decision.

---

## 4. "Risk is always protected"

- **Drawdown Guardrail** chart — current drawdown vs limit and kill-switch
  threshold over time

Message: Veydrift is built not to blow up. The kill-switch sits below
the limit.

---

## 5. "Every action is real"

- **Latest Autonomous Order** — pair (e.g. BTCUSDT), side (buy/sell),
  amount, USD value, reason, time, Bitget order ID
- **Decision Log** — full history of autonomous, reasoned, provable actions

Message: every order has a real Bitget order ID verifiable via the
Bitget API or account dashboard.

---

## 6. Demo do / don't

- **DO** show a real Bitget order ID with verifiable proof.
- **DO** keep language spot-only (order/buy/sell/rebalance).
- **DON'T** say perps, leverage, long, short, liquidation, order book.
- **DON'T** show any pair outside BTCUSDT/ETHUSDT/USDT.
- **DON'T** present mock numbers as live without saying so.
