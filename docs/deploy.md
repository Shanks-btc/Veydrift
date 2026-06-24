# Veydrift — Railway Deployment Guide

## 1. Architecture overview

Single Railway service. `server.js` is the entrypoint.
It spawns the Next.js dashboard and runs the agent cycle on a timer.

---

## 2. Environment variables

Set as encrypted secrets in Railway dashboard.

**Required for live execution:**

| Variable | Notes |
|---|---|
| `BITGET_API_KEY` | Bitget API key. Never logged. |
| `BITGET_SECRET_KEY` | Bitget secret key. Never logged. Redacted in audit. |
| `BITGET_PASSPHRASE` | Bitget passphrase. Never logged. Redacted in audit. |
| `I_UNDERSTAND_REAL_FUNDS` | Must be exact string `"yes"` to enable live orders. |

**Optional:**

| Variable | Default | Notes |
|---|---|---|
| `BITGET_API_BASE_URL` | https://api.bitget.com | Override API base URL. |
| `BITGET_TIMEOUT_MS` | 15000 | Request timeout in ms. |
| `KEEL_DATA_DIR` | /app/data | Data directory on Railway volume. |

---

## 3. Persistent volume

Railway persistent volume must be mounted at `/app/data`.
This stores: `agent-state.json`, `audit.jsonl`, `portfolio-snapshot.json`,
`pnl-baseline.json`, `drawdown-history.json`.

---

## 4. First-run checklist

- [ ] `BITGET_API_KEY` set as encrypted secret
- [ ] `BITGET_SECRET_KEY` set as encrypted secret
- [ ] `BITGET_PASSPHRASE` set as encrypted secret
- [ ] `I_UNDERSTAND_REAL_FUNDS=yes` set when ready for live orders
- [ ] `KEEL_DATA_DIR=/app/data` set
- [ ] Railway volume mounted at `/app/data`
- [ ] Deploy and check logs for `[veydrift runner]` cycle start

---

## 5. What the runner does NOT guarantee

- Not guaranteed to order every cycle. Gates must all pass.
- Not guaranteed to fill at the expected price. Market orders use
  Bitget's current best price.
- Credentials are never logged. Audit output always shows `<redacted>`.

---

## 6. Trading pairs

SPOT only. Forbidden: perps, futures, leverage, margin.

| Pair | Role |
|---|---|
| BTCUSDT | Volatile |
| ETHUSDT | Volatile |
| USDT | Stable (held when reducing volatile exposure) |
