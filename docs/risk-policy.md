# Veydrift — Risk Policy

The rules that govern how Keel takes and limits risk. This is the authoritative
description of the risk engine and guardrails. Values marked "default" are tunable
but must stay internally consistent (e.g. kill-switch ≥ drawdown alert).

---

## 1. Inputs (what the engine reads)

Only four live signals, sourced from Bitget Skill Hub and Bitget public REST API:

- `price` — current USD price of the volatile asset.
- `change_1h` — percent change over 1 hour.
- `change_24h` — percent change over 24 hours.
- `fearGreed` — Fear & Greed index (0–100).

No other signals are computed today. The UI and any reporting must reflect only
these.

---

## 2. Risk score

One score `R ∈ [0, 1]`. Higher `R` = more danger = more defensive.

```
R = clamp01(
      min(1, |change_1h|  / 3 ) * 0.40   // short-term volatility
    + min(1, |change_24h| / 10) * 0.40   // daily volatility
    + max(0, (fearGreed - 60) / 40) * 0.20  // greed premium
)
```

- Large recent moves (either direction) raise `R` — violent tapes threaten
  drawdown.
- **Greed** (Fear & Greed above 60) raises `R` — euphoria is a blow-off risk.
- **Plain fear does not raise `R`.** A calm-but-fearful tape is treated as a
  potential entry, not a danger. Intentional and tunable.

Worked example (observed): `1h 0.24%`, `24h 2.10%`, `F&G 23` →
`R ≈ 0.03 + 0.08 + 0 = 0.12` → **Risk-on**.

---

## 3. Modes and target exposure

| `R` range    | Mode      | Target volatile exposure | Remainder |
|--------------|-----------|--------------------------|-----------|
| `R < 0.33`   | Risk-on   | ~80%                     | stables   |
| `0.33–0.66`  | Neutral   | ~45%                     | stables   |
| `R ≥ 0.66`   | Risk-off  | ~18% (never 0)           | stables   |

Risk-off is **mostly stables, not zero**. The agent stays deployed; only the
kill-switch flattens to stables fully.

---

## 4. Guardrails

All five are enforced in code, not cosmetic.

### 4.1 Token allowlist
Tradeable pairs (Bitget spot):
- Volatile: **BTCUSDT, ETHUSDT**
- Stable: **USDT** (quote currency, held when reducing volatile exposure)

Any pair outside this list is rejected.

### 4.2 Per-trade cap (default)
No single swap exceeds a set fraction of portfolio value (default ~25%). Prevents
one oversized rotation.

### 4.3 Daily-loss cap (default)
If realized+unrealized loss for the day crosses a threshold, stop opening new
risk for the rest of the day (de-risk only). Protects against a bad-day spiral.

### 4.4 Slippage limit (default)
Before executing, validate the TWAK quote's `priceImpact` and `minReceived`. If
the effective slippage exceeds the limit (default ~1%), **do not execute**.

### 4.5 Max-drawdown kill-switch (hard backstop)
Track drawdown from the portfolio's high-water mark.
- **Kill-switch threshold (default ~18%)** — on breach, immediately rotate to
  **stables** (in-scope, full value) and halt risk-taking. **Never to dust.**
- Keep the kill-switch comfortably below any externally imposed drawdown limit so
  it triggers first.

---

## 5. Anti-churn (cost awareness)

Trades cost money (real and/or simulated). To avoid bleeding value:

- **Rebalance band:** only rebalance when current exposure deviates from target
  by more than a band (don't flip on noise).
- **Mode hysteresis:** switch modes on genuine signal, not jitter around a
  threshold.
- **Tiny liveness trades:** any required minimum-activity action is kept small.

---

## 6. Liveness

The agent performs at least one action per day so it remains demonstrably live.
Liveness actions are small and respect all guardrails.

---

## 7. Never-dust invariant

At no point should the portfolio be drained to a sub-dust balance. Risk-off and
the kill-switch both target stables. Holding non-zero in-scope assets is a
standing invariant.

---

## 8. Tuning notes

- The component weights (0.40 / 0.40 / 0.20) and the mode thresholds
  (0.33 / 0.66) are the primary tuning knobs.
- If a more defensive posture in fear is ever desired, add a fear term — but that
  is a deliberate policy change, documented here, not an ad-hoc tweak.
- Keep `kill-switch < daily-loss spiral < any external hard limit` ordering
  intact.