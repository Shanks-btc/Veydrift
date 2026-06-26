from decimal import Decimal
from typing import Optional, Tuple

from nautilus_trader.config import StrategyConfig
from nautilus_trader.model.data import Bar, BarType
from nautilus_trader.model.identifiers import InstrumentId
from nautilus_trader.trading.strategy import Strategy

from getagent import runtime

from .indicators import compute_risk_score, get_mode, get_target_volatile_pct, needs_rebalance
from .risk import check_drawdown_guardrail


class VeydriftStrategyConfig(StrategyConfig):
    instrument_ids: Tuple[str, ...] = ()
    margin_budget: str = "100"
    rebalance_threshold_pct: float = 5.0
    drawdown_kill_pct: float = 15.0
    order_id_tag: str = "001"


class VeydriftStrategy(Strategy):
    def __init__(self, config: VeydriftStrategyConfig) -> None:
        super().__init__(config)
        self.config = config
        self._hwm: float = float(config.margin_budget)
        self._current_volatile_pct: float = 0.0
        self._bar_counts: dict = {}
        self._last_close: dict = {}
        self._open_prices: dict = {}

    def on_start(self) -> None:
        cfg = runtime.manifest.get("strategy_config", {})
        self._margin_budget = float(cfg.get("margin_budget", self.config.margin_budget))
        self._rebalance_threshold = float(
            cfg.get("rebalance_threshold_pct", self.config.rebalance_threshold_pct)
        )
        self._drawdown_kill = float(
            cfg.get("drawdown_kill_pct", self.config.drawdown_kill_pct)
        )

        for iid_str in self.config.instrument_ids:
            instrument_id = InstrumentId.from_str(iid_str)
            bar_type = BarType.from_str(f"{iid_str}-1-HOUR-LAST-EXTERNAL")
            self.subscribe_bars(bar_type)
            self._bar_counts[iid_str] = 0
            self._last_close[iid_str] = None
            self._open_prices[iid_str] = []

    def on_bar(self, bar: Bar) -> None:
        iid_str = str(bar.bar_type.instrument_id)
        self._bar_counts[iid_str] = self._bar_counts.get(iid_str, 0) + 1
        close = float(bar.close)
        self._last_close[iid_str] = close

        history = self._open_prices.get(iid_str, [])
        history.append(close)
        if len(history) > 25:
            history = history[-25:]
        self._open_prices[iid_str] = history

        if not all(self._last_close.get(s) is not None for s in self.config.instrument_ids):
            return

        self._evaluate()

    def _evaluate(self) -> None:
        fear_greed = getattr(self, "_latest_fear_greed", 50.0)

        risk_scores = []
        for iid_str in self.config.instrument_ids:
            history = self._open_prices.get(iid_str, [])
            if len(history) < 25:
                return
            close_now = history[-1]
            close_1h_ago = history[-2] if len(history) >= 2 else close_now
            close_24h_ago = history[-25] if len(history) >= 25 else history[0]
            change_1h = (close_now - close_1h_ago) / close_1h_ago * 100.0 if close_1h_ago else 0.0
            change_24h = (close_now - close_24h_ago) / close_24h_ago * 100.0 if close_24h_ago else 0.0
            r = compute_risk_score(change_1h, change_24h, fear_greed)
            risk_scores.append((iid_str, r, change_1h, change_24h))

        if not risk_scores:
            return

        avg_r = sum(s[1] for s in risk_scores) / len(risk_scores)
        avg_1h = sum(s[2] for s in risk_scores) / len(risk_scores)
        avg_24h = sum(s[3] for s in risk_scores) / len(risk_scores)

        portfolio_value = self._margin_budget
        kill = check_drawdown_guardrail(portfolio_value, self._hwm, self._drawdown_kill)
        if portfolio_value > self._hwm:
            self._hwm = portfolio_value

        if kill:
            mode = "risk_off"
            target_volatile = 0.18
            reason = f"drawdown guardrail triggered (portfolio fell >{self._drawdown_kill}% from HWM)"
        else:
            mode = get_mode(avg_r)
            target_volatile = get_target_volatile_pct(mode)
            reason = (
                f"risk_score={avg_r:.3f} mode={mode} "
                f"change_1h={avg_1h:.2f}% change_24h={avg_24h:.2f}% "
                f"fear_greed={fear_greed:.0f}"
            )

        if not needs_rebalance(
            self._current_volatile_pct, target_volatile * 100.0, self._rebalance_threshold
        ):
            return

        self._current_volatile_pct = target_volatile * 100.0
        target_per_symbol = target_volatile / len(self.config.instrument_ids)

        for iid_str in self.config.instrument_ids:
            symbol = iid_str.split(".")[0]
            side = "buy" if target_per_symbol > 0 else "hold"
            runtime.emit_signal(
                action=side,
                symbol=symbol,
                confidence=1.0 - avg_r,
                metrics={
                    "risk_score": avg_r,
                    "mode": mode,
                    "target_pct": target_per_symbol * 100.0,
                    "reason": reason,
                },
            )

    def on_stop(self) -> None:
        for iid_str in self.config.instrument_ids:
            instrument_id = InstrumentId.from_str(iid_str)
            self.cancel_all_orders(instrument_id)
            self.close_all_positions(instrument_id)
