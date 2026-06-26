import json
import pathlib

from getagent import backtest, data, runtime

from .strategy import VeydriftStrategy, VeydriftStrategyConfig


def run() -> None:
    cfg = runtime.manifest.get("strategy_config", {})
    margin_budget = float(cfg.get("margin_budget", "100"))
    rebalance_threshold = float(cfg.get("rebalance_threshold_pct", 5.0))
    drawdown_kill = float(cfg.get("drawdown_kill_pct", 15.0))

    symbols = ["BTCUSDT", "ETHUSDT"]

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

    btc_df = data.to_dataframe(btc_bars)
    eth_df = data.to_dataframe(eth_bars)
    fg_df = data.to_dataframe(fg_raw)

    btc_df = btc_df.rename(columns={"date": "time"})
    eth_df = eth_df.rename(columns={"date": "time"})
    fg_df = fg_df.rename(columns={"date": "time"})

    btc_df["quote_volume"] = btc_df["volume"]
    eth_df["quote_volume"] = eth_df["volume"]

    fg_df["time"] = fg_df["time"].astype(str).str[:13]
    btc_df["fg_time"] = btc_df["time"].astype(str).str[:13]
    eth_df["fg_time"] = eth_df["time"].astype(str).str[:13]

    import pandas as pd
    fg_map = fg_df.set_index("time")["value"].to_dict()

    btc_df["fear_greed"] = btc_df["fg_time"].map(fg_map).fillna(50.0)
    eth_df["fear_greed"] = eth_df["fg_time"].map(fg_map).fillna(50.0)
    btc_df = btc_df.drop(columns=["fg_time"])
    eth_df = eth_df.drop(columns=["fg_time"])

    spec = runtime.backtest_spec
    instrument_ids = ("BTCUSDT.BINANCE", "ETHUSDT.BINANCE")

    strategy_config = VeydriftStrategyConfig(
        instrument_ids=instrument_ids,
        margin_budget=str(margin_budget),
        rebalance_threshold_pct=rebalance_threshold,
        drawdown_kill_pct=drawdown_kill,
    )

    result = backtest.run(
        ohlcv_data={
            "BTCUSDT.BINANCE": btc_df,
            "ETHUSDT.BINANCE": eth_df,
        },
        spec=spec,
        strategy_config=strategy_config,
    )

    out_dir = pathlib.Path("/workspace/output")
    out_dir.mkdir(parents=True, exist_ok=True)

    backtest.generate_chart(result, output_dir=str(out_dir))

    summary = result.summary or {}
    net_pnl = float(summary.get("net_pnl", 0) or 0)
    total_return_pct = net_pnl / margin_budget * 100.0 if margin_budget > 0 else 0.0

    raw = result.raw or {}
    raw["net_pnl"] = net_pnl
    raw["total_return_pct"] = total_return_pct

    report = {
        "total_return_pct": total_return_pct,
        "net_pnl": net_pnl,
        "max_drawdown_pct": result.max_drawdown_pct,
        "sharpe_ratio": result.sharpe_ratio,
        "win_rate": result.win_rate,
        "total_trades": result.total_trades,
        "profit_factor": result.profit_factor,
        "starting_balance": summary.get("starting_balance"),
        "raw": raw,
    }

    report_path = out_dir / "backtest_report.json"
    report_path.write_text(json.dumps(report, indent=2))

    side = "buy" if net_pnl > 0 else "hold"
    runtime.emit_signal(
        action=side,
        symbol="BTCUSDT",
        confidence=max(0.0, min(1.0, result.win_rate or 0.5)),
        metrics=report,
    )
