def check_drawdown_guardrail(
    current_value: float,
    hwm: float,
    kill_pct: float,
) -> bool:
    """Returns True if the kill-switch should trigger (force risk-off)."""
    if hwm <= 0:
        return False
    drawdown = (current_value - hwm) / hwm * 100.0
    return drawdown <= -kill_pct
