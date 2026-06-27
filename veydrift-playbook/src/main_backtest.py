import pathlib

from getagent import backtest, data, runtime


def run() -> None:
    cfg = runtime.manifest.get("strategy_config", {})
    margin_budget = float(cfg.get("margin_budget", "100"))

    btc_bars = data.crypto.spot.kline(
        symbol="BTCUSDT",
        interval="1h",
        exchange="binance",
        days=90,
    )
    eth_bars = data.crypto.spot.kline(
        symbol="ETHUSDT",
        interval="1h",
        exchange="binance",
        days=90,
    )

    fg_raw = data.crypto.sentiment.crypto_fear_greed(limit=90)

    btc_df = backtest.prepare_frame(btc_bars, datetime_index="date")
    eth_df = backtest.prepare_frame(eth_bars, datetime_index="date")

    btc_df = backtest.build_feature_frame(
        btc_df,
        features=[
            backtest.FeatureSource(
                data=fg_raw,
                datetime_index="date",
                include_columns=("value",),
                rename_columns={"value": "fear_greed"},
                mode="asof",
            )
        ],
    )
    eth_df = backtest.build_feature_frame(
        eth_df,
        features=[
            backtest.FeatureSource(
                data=fg_raw,
                datetime_index="date",
                include_columns=("value",),
                rename_columns={"value": "fear_greed"},
                mode="asof",
            )
        ],
    )

    btc_df["fear_greed"] = btc_df["fear_greed"].fillna(50.0)
    eth_df["fear_greed"] = eth_df["fear_greed"].fillna(50.0)

    # backtest.yaml declares quote_volume in data_requirements.required_bar_fields;
    # crypto.spot.kline does not return a native quote_volume column so we derive it.
    btc_df["quote_volume"] = btc_df["volume"]
    eth_df["quote_volume"] = eth_df["volume"]

    result = backtest.run(
        ohlcv_data={
            "BTCUSDT.BINANCE": btc_df,
            "ETHUSDT.BINANCE": eth_df,
        },
        spec=runtime.backtest_spec,
    )

    out_dir = pathlib.Path("/workspace/output")
    out_dir.mkdir(parents=True, exist_ok=True)
    chart_path = backtest.generate_chart(result, save_dir=str(out_dir))

    summary = result.summary or {}
    net_pnl = float(summary.get("net_pnl", 0) or 0)
    total_return_pct = net_pnl / margin_budget * 100.0 if margin_budget > 0 else 0.0

    runtime.emit_signal(
        action="buy" if net_pnl > 0 else "hold",
        symbol="BTCUSDT",
        confidence=max(0.0, min(1.0, result.win_rate or 0.5)),
        metrics={
            "total_return_pct": total_return_pct,
            "net_pnl": net_pnl,
            "max_drawdown_pct": result.max_drawdown_pct,
            "sharpe_ratio": result.sharpe_ratio,
            "win_rate": result.win_rate,
            "total_trades": result.total_trades,
            "profit_factor": result.profit_factor,
            "margin_budget": margin_budget,
        },
        meta={"chart_path": chart_path},
    )
