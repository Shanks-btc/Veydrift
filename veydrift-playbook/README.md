# Veydrift — Risk-Managed Spot Rotation

## 策略 / Strategy

Veydrift is a spot rotation strategy that continuously scores market risk
from three signals — short-term price momentum, daily price momentum, and
crowd sentiment — and allocates capital between volatile assets (BTC and ETH)
and stable holdings (USDT) accordingly.

The strategy runs on hourly bars and computes a deterministic risk score each
time it fires. No LLM, no prediction, no black box: the same inputs always
produce the same regime classification and target allocation. It trades only
spot pairs — BTCUSDT and ETHUSDT — with no leverage, no shorts, and no
perpetuals.

## 开仓 / Entry

The strategy increases its BTC and ETH allocation when the computed risk score
falls into the calm regime. A calm regime is one where price movement over
the past hour and the past day is muted, and crowd sentiment has not crossed
into greed territory. In that regime the strategy targets its highest volatile
allocation, split equally between BTC and ETH.

A moderate regime — where momentum is mildly elevated or sentiment is rising
but not extreme — results in a middle allocation. Both are entered positions;
they differ only in how much capital is placed in volatile assets vs stables.

## 平仓 / Exit

The strategy exits (reduces volatile allocation) when the risk score rises
into the elevated regime. Exits are partial — the volatile allocation steps
down to a minimum floor rather than closing to zero, so the strategy always
holds some BTC and ETH and can participate in recovery without a separate
re-entry decision.

A hard drawdown guardrail overrides the regime score: if the portfolio value
falls significantly from its high-water mark, the strategy forces the minimum
volatile allocation regardless of current momentum or sentiment readings.
This protects capital during rapid drawdowns and resets automatically as the
portfolio recovers.

Rebalancing only fires when the actual allocation deviates from the target
by more than the configured threshold, reducing friction from small drift.

## Parameters

**margin_budget** — the total USDT capital base for this strategy. The
platform sizes orders against this value and uses it as the denominator for
return percentage. Set it to the capital you are genuinely willing to deploy.
Raising it increases absolute position size; the percentage return is
unaffected.

**rebalance_threshold_pct** — how far the actual portfolio allocation must
drift from the target before a rebalancing trade fires. A lower value keeps
the portfolio tightly aligned at the cost of more frequent small trades. A
higher value reduces trade frequency and transaction costs but allows the
portfolio to drift further from the target allocation.

## How To Read Backtest Metrics

- **total_return_pct**: strategy-budget return (net_pnl / margin_budget).
- **max_drawdown_pct**: largest peak-to-trough decline during the backtest.
- **win_rate** + **total_trades**: what fraction of trades were profitable,
  and how many trades fired. A high return on very few trades is not robust.
- **sharpe_ratio**: risk-adjusted return. Values above 1.0 suggest the
  strategy was compensated for the volatility it took on.

## 风险 / Risk

This strategy underperforms in sustained trending bull markets where holding
maximum volatile exposure would capture more upside uninterrupted. The drawdown
guardrail may rotate into stables near a local bottom and miss the recovery.

Momentum and sentiment can temporarily disagree, producing a middle-tier
allocation during both rising and falling markets. The strategy does not
predict direction — it only adjusts size based on the current risk reading.

Backtest results are historical and not a guarantee of future performance.
Strategy return and account return diverge when margin_budget differs from
actual deployed capital. Do not run this strategy with capital you cannot
afford to lose.
