from decimal import Decimal
from typing import Optional

from nautilus_trader.config import StrategyConfig
from nautilus_trader.model.data import Bar, BarType
from nautilus_trader.model.enums import OrderSide, TimeInForce
from nautilus_trader.model.identifiers import InstrumentId
from nautilus_trader.model.objects import Quantity
from nautilus_trader.trading.strategy import Strategy

from .indicators import compute_risk_score, get_mode, get_target_volatile_pct, needs_rebalance
from .risk import check_drawdown_guardrail


class VeydriftStrategyConfig(StrategyConfig):
    instrument_id: Optional[InstrumentId] = None
    bar_type: Optional[BarType] = None
    instrument_ids: tuple[InstrumentId, ...] = ()
    bar_types: tuple[BarType, ...] = ()
    trade_size: str = "0.01"
    rebalance_threshold_pct: float = 5.0
    drawdown_kill_pct: float = 15.0
    order_id_tag: str = "001"


class VeydriftStrategy(Strategy):
    def __init__(self, config: VeydriftStrategyConfig) -> None:
        super().__init__(config)
        self.cfg = config
        self._price_history: dict = {}   # iid_str -> list[float], max 25 bars
        self._positions: dict = {}       # iid_str -> "LONG" | "NONE"
        self._hwm: float = 0.0
        self._current_volatile_pct: float = 0.0

    def on_start(self) -> None:
        # Prefer injected bar_types from runner; fall back to singular bar_type
        bar_types_to_use = list(self.cfg.bar_types)
        if not bar_types_to_use and self.cfg.bar_type is not None:
            bar_types_to_use = [self.cfg.bar_type]

        for bar_type in bar_types_to_use:
            iid_str = str(bar_type.instrument_id)
            self.subscribe_bars(bar_type)
            self._price_history[iid_str] = []
            self._positions[iid_str] = "NONE"

    def on_bar(self, bar: Bar) -> None:
        iid_str = str(bar.bar_type.instrument_id)
        close = float(bar.close)

        history = self._price_history.get(iid_str, [])
        history.append(close)
        if len(history) > 25:
            history = history[-25:]
        self._price_history[iid_str] = history

        # Wait until every subscribed instrument has 25 bars of history
        if not all(len(h) >= 25 for h in self._price_history.values()):
            return

        self._evaluate()

    def _evaluate(self) -> None:
        fear_greed = 50.0  # constant in backtest; no live sentiment data in replay

        risk_scores = []
        sum_price = 0.0
        for iid_str, history in self._price_history.items():
            close_now = history[-1]
            close_1h_ago = history[-2]
            close_24h_ago = history[-25]
            change_1h = (close_now - close_1h_ago) / close_1h_ago * 100.0 if close_1h_ago else 0.0
            change_24h = (close_now - close_24h_ago) / close_24h_ago * 100.0 if close_24h_ago else 0.0
            risk_scores.append(compute_risk_score(change_1h, change_24h, fear_greed))
            sum_price += close_now

        avg_r = sum(risk_scores) / len(risk_scores)
        avg_price = sum_price / len(self._price_history)

        # Use average price as portfolio-value proxy for HWM / drawdown tracking
        if self._hwm == 0.0:
            self._hwm = avg_price
        elif avg_price > self._hwm:
            self._hwm = avg_price

        kill = check_drawdown_guardrail(avg_price, self._hwm, self.cfg.drawdown_kill_pct)
        mode = "risk_off" if kill else get_mode(avg_r)
        target_volatile = get_target_volatile_pct(mode)

        if not needs_rebalance(
            self._current_volatile_pct,
            target_volatile * 100.0,
            self.cfg.rebalance_threshold_pct,
        ):
            return

        self._current_volatile_pct = target_volatile * 100.0

        for iid_str in self._price_history:
            instrument_id = InstrumentId.from_str(iid_str)
            instrument = self.cache.instrument(instrument_id)
            if instrument is None:
                continue

            qty = Quantity(Decimal(self.cfg.trade_size), instrument.size_precision)
            current_pos = self._positions.get(iid_str, "NONE")

            if target_volatile > 0.18 and current_pos == "NONE":
                order = self.order_factory.market(
                    instrument_id=instrument_id,
                    order_side=OrderSide.BUY,
                    quantity=qty,
                    time_in_force=TimeInForce.GTC,
                )
                self.submit_order(order)
                self._positions[iid_str] = "LONG"

            elif mode == "risk_off" and current_pos == "LONG":
                for position in self.cache.positions_open(instrument_id=instrument_id):
                    close_order = self.order_factory.market(
                        instrument_id=instrument_id,
                        order_side=OrderSide.SELL,
                        quantity=position.quantity,
                        time_in_force=TimeInForce.GTC,
                    )
                    self.submit_order(close_order)
                self._positions[iid_str] = "NONE"

    def on_stop(self) -> None:
        for iid_str in list(self._price_history.keys()):
            instrument_id = InstrumentId.from_str(iid_str)
            self.cancel_all_orders(instrument_id)
            self.close_all_positions(instrument_id)
