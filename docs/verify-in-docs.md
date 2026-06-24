# Veydrift — Verification Record

Honest record of what was actually tested and what was not.

Status classification:
- **confirmed** — tested successfully, real output observed
- **partial** — partially exercised
- **not yet tested** — not exercised at all
- **pending** — planned but not started

**Honesty rule:** do not upgrade any item to "confirmed" without a real
successful run. Paste raw output into docs/ or a proofs/ file.

Environment: Windows, Node v24.14.0, Python 3.14.5

---

## Integration status

| # | Integration | Status |
|---|---|---|
| 1 | Bitget public REST API (from Railway) | confirmed |
| 2 | Bitget authenticated REST API (from Railway) | confirmed |
| 3 | Bitget public REST API (from local machine, UK) | blocked — geo-restricted |
| 4 | Bitget MCP server install | confirmed |
| 5 | Bitget MCP `--paper-trading` flag | confirmed (flag recognized) |
| 6 | Bitget MCP paper trading with regular key | not available (error 40099) |
| 7 | Bitget MCP paper trading with Demo key | not yet tested (Demo key needed) |
| 8 | Bitget Skill Hub `technical-analysis` | not yet tested |
| 9 | Bitget Skill Hub `sentiment-analyst` | not yet tested |
| 10 | Bitget Skill Hub `macro-analyst` | not yet tested |
| 11 | Bitget Skill Hub `market-intel` | not yet tested |
| 12 | Bitget Skill Hub `news-briefing` | not yet tested |
| 13 | `spot_place_order` (live order) | not yet tested |
| 14 | `get_account_assets` (real balance) | not yet tested |
| 15 | `spot_get_fills` (order history) | not yet tested |
| 16 | getagent-skill install | confirmed |
| 17 | Python backtest (NautilusTrader) | not yet tested |
| 18 | Risk engine formula | confirmed (293 tests passing) |
| 19 | Guardrail chain | confirmed (293 tests passing) |
| 20 | Railway deployment | partial (project created, not yet deployed) |

---

## Detail per integration

### 1 & 2. Bitget REST API — confirmed

Tested from Railway container (SSH session).

Public:
```
GET https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT
→ code: 00000, price: 62766.78, change24h: -0.00433
```

Authenticated:
```
GET https://api.bitget.com/api/v2/spot/account/assets
→ code: 00000, msg: success, assets count: 3
```

HMAC-SHA256 signing: `timestamp + method + path + body`, then base64.

### 3. Local API access — blocked

`api.bitget.com` returns `ENOTFOUND` from UK network.
Solution: always test from Railway container, not local machine.

### 4 & 5. Bitget MCP server — confirmed

`bitget-mcp-server` v1.1.0 installed globally.
`npx bitget-mcp-server --help` → exit code 0, all flags documented.
`npx bitget-mcp-server --paper-trading --help` → exit code 0,
flag recognized, description: "Enable Demo Trading mode (requires
Demo API Key)".

### 6. Paper trading with regular key — not available

Testing `paptrading: 1` header with regular Trading key returned:
`code: 40099, msg: "exchange environment is incorrect"`
Conclusion: paper trading requires a separate Demo API key from
Bitget's Demo Trading environment.

### 7. Demo API key — not yet tested

Demo Trading UI not found at standard Bitget URL.
May be geo-restricted in UK. Status: PENDING investigation.

### 18 & 19. Risk engine and guardrails — confirmed

Inherited from Keel. All 293 tests pass.
`engine.ts`, `cycle.ts`, `gate.ts` are PROTECTED — never modify.

---

## Confirmed reference values

```
Bitget API base URL:  https://api.bitget.com
Signing method:       HMAC-SHA256(timestamp + METHOD + path + body, secretKey)
                      then base64 encode
MCP server version:   1.1.0
MCP default modules:  spot, futures, account
Available modules:    spot, futures, account, margin, copytrading,
                      convert, earn, p2p, broker
getagent-skill version: 0.3.3
Python backtest engine: NautilusTrader (via getagent-skill)
```

---

## What is NOT yet recorded

- Raw Bitget Skill Hub responses (skills not yet called)
- Real `spot_place_order` response (not yet executed)
- Real `get_account_assets` response from MCP (not yet called via MCP)
- Python backtest output (not yet run)

Paste raw outputs into `docs/verify-in-docs.md` or a `proofs/` directory
as each integration is tested.
