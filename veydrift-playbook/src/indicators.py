import math


def compute_risk_score(change_1h: float, change_24h: float, fear_greed: float) -> float:
    momentum_1h = min(1.0, abs(change_1h) / 3.0) * 0.40
    momentum_24h = min(1.0, abs(change_24h) / 10.0) * 0.40
    sentiment = max(0.0, (fear_greed - 60.0) / 40.0) * 0.20
    raw = momentum_1h + momentum_24h + sentiment
    return max(0.0, min(1.0, raw))


def get_mode(risk_score: float) -> str:
    if risk_score < 0.33:
        return "risk_on"
    if risk_score < 0.66:
        return "neutral"
    return "risk_off"


def get_target_volatile_pct(mode: str) -> float:
    if mode == "risk_on":
        return 0.50
    if mode == "neutral":
        return 0.35
    return 0.18


def needs_rebalance(current_pct: float, target_pct: float, threshold_pct: float) -> bool:
    return abs(current_pct - target_pct) > threshold_pct
