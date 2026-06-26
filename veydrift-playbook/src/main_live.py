from getagent import data, runtime

from .indicators import compute_risk_score, get_mode, get_target_volatile_pct, needs_rebalance
from .risk import check_drawdown_guardrail


def run() -> None:
    cfg = runtime.manifest.get("strategy_config", {})
    margin_budget = float(cfg.get("margin_budget", "100"))
    rebalance_threshold = float(cfg.get("rebalance_threshold_pct", 5.0))
    drawdown_kill = float(cfg.get("drawdown_kill_pct", 15.0))

    btc_bars = data.crypto.spot.kline(symbol="BTCUSDT", interval="1h", exchange="binance", days=2)
    eth_bars = data.crypto.spot.kline(symbol="ETHUSDT", interval="1h", exchange="binance", days=2)
    fg_raw = data.crypto.sentiment.crypto_fear_greed(limit=1)

    btc_df = data.to_dataframe(btc_bars)
    eth_df = data.to_dataframe(eth_bars)
    fg_df = data.to_dataframe(fg_raw)

    fear_greed = float(fg_df["value"].iloc[-1]) if len(fg_df) > 0 else 50.0

    results = []
    for symbol, df in [("BTCUSDT", btc_df), ("ETHUSDT", eth_df)]:
        if len(df) < 25:
            continue
        close_now = float(df["close"].iloc[-1])
        close_1h = float(df["close"].iloc[-2]) if len(df) >= 2 else close_now
        close_24h = float(df["close"].iloc[-25]) if len(df) >= 25 else float(df["close"].iloc[0])
        change_1h = (close_now - close_1h) / close_1h * 100.0 if close_1h else 0.0
        change_24h = (close_now - close_24h) / close_24h * 100.0 if close_24h else 0.0
        r = compute_risk_score(change_1h, change_24h, fear_greed)
        results.append((symbol, r, change_1h, change_24h))

    if not results:
        return

    avg_r = sum(x[1] for x in results) / len(results)
    mode = get_mode(avg_r)
    target_volatile = get_target_volatile_pct(mode)

    kill = check_drawdown_guardrail(margin_budget, margin_budget, drawdown_kill)
    if kill:
        mode = "risk_off"
        target_volatile = 0.18

    target_per_symbol = target_volatile / len(results)

    for symbol, r, ch1h, ch24h in results:
        reason = (
            f"risk_score={avg_r:.3f} mode={mode} "
            f"change_1h={ch1h:.2f}% change_24h={ch24h:.2f}% "
            f"fear_greed={fear_greed:.0f}"
        )

        def _trade_cb():
            pass

        runtime.emit_signal_or_follow(
            action="buy",
            symbol=symbol,
            confidence=1.0 - avg_r,
            metrics={
                "risk_score": avg_r,
                "mode": mode,
                "target_pct": target_per_symbol * 100.0,
                "reason": reason,
            },
            trade_callback=_trade_cb,
        )
