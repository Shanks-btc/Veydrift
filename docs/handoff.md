# Veydrift — Handoff

For whoever (or whatever) picks up the build next. Practical state of
the repo: what exists, what works, exact commands and values, what to
build next, and rules that prevent regressions.

Read docs/plan.md and docs/verify-in-docs.md alongside this.

---

## 1. What Veydrift is (one paragraph)

Veydrift is an autonomous spot trading agent on Bitget CEX. It reads
market signals from the Bitget Skill Hub (5 skills), computes a
deterministic 3-component risk score, and rotates a spot portfolio
between BTCUSDT and ETHUSDT via the Bitget MCP server, with strict
guardrails and a max-drawdown kill-switch. Spot only — no perps,
leverage, long/short, or liquidation.

---

## 2. Environment (confirmed)

- OS: Windows
- Node: v24.14.0
- Python: 3.14.5
- Package manager: npm workspaces (do NOT switch to pnpm)
- Bitget MCP server: v1.1.0 (globally installed)
- getagent-skill: v0.3.3 (globally installed)
- bitget-hub CLI: v1.0.0 (globally installed)
- Bitget API: reachable from Railway, blocked locally in UK

---

## 3. Files already in the repo

- `packages/agent/src/risk/engine.ts` — PROTECTED. Deterministic risk
  engine. Do not modify. 293 tests pass.
- `packages/agent/src/loop/cycle.ts` — PROTECTED. Core cycle. Do not
  modify.
- `packages/agent/src/loop/gate.ts` — PROTECTED. Guardrail chain. Do
  not modify.
- `packages/agent/src/runner.ts` — Adapt for Bitget balance reading.
  Currently reads from env vars (`PORTFOLIO_VALUE_USD` etc). Needs
  `get_account_assets` call instead.
- `packages/agent/src/execution/twak.ts` — EXISTS but not used in
  Veydrift. Do not delete yet; create `bitget.ts` alongside it.
- `packages/agent/src/perception/` — Create `bitget-skills.ts` here.
- `apps/web/` — Dashboard. Next.js 15, TypeScript, Tailwind, Recharts.
  Functional but shows Keel branding. Rebranding PENDING.
- `packages/shared/` — TypeScript types. May need new fields for Bitget
  order IDs.
- `server.js` — Railway entrypoint. Works. Log prefixes say `[keel]`,
  need updating to `[veydrift]`.
- `docs/` — These documents.
- `.env.example` — Needs updating for Bitget env vars.

---

## 4. Confirmed API facts (for use in code)

### Bitget public REST (no auth needed)
```
GET https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT
```
Response fields: `lastPr`, `change24h`, `high24h`, `low24h`, `open24h`
Confirmed reachable from Railway: code 00000, real BTC price returned.

### Bitget authenticated REST
```
GET https://api.bitget.com/api/v2/spot/account/assets
Headers: ACCESS-KEY, ACCESS-SIGN, ACCESS-TIMESTAMP, ACCESS-PASSPHRASE
Signing: HMAC-SHA256(timestamp + method + path + body, secretKey)
         then base64 encode
```
Confirmed working: code 00000, assets count: 3 returned.

### Bitget MCP server
```
Install: npm install -g bitget-mcp-server  (v1.1.0)
Run:     npx bitget-mcp-server [--read-only] [--paper-trading]
```
Paper trading: adds `paptrading: 1` header to all requests.
               REQUIRES Demo API key (separate from regular key).
               Regular key returns error 40099 with paper trading.

Key tools:
- `spot_get_ticker` — public, no auth
- `spot_get_candles` — public, no auth
- `get_account_assets` — private, needs auth
- `spot_place_order` — private, WRITE, needs Trade permission
- `spot_get_fills` — private, needs auth

### Bitget Skill Hub
```
Install: npx bitget-hub upgrade-all --target claude
Skills:  technical-analysis, sentiment-analyst, macro-analyst,
         market-intel, news-briefing
```
These are Claude Code skills, not MCP tools.

---

## 5. Environment variables needed

**Required for live execution:**

| Variable | Notes |
|---|---|
| `BITGET_API_KEY` | Bitget API key |
| `BITGET_SECRET_KEY` | Bitget secret key |
| `BITGET_PASSPHRASE` | Bitget passphrase |
| `I_UNDERSTAND_REAL_FUNDS` | Must be `"yes"` to enable live orders |

**Optional:**

| Variable | Default | Notes |
|---|---|---|
| `BITGET_API_BASE_URL` | https://api.bitget.com | Override API base URL |
| `BITGET_TIMEOUT_MS` | 15000 | Request timeout in ms |
| `KEEL_DATA_DIR` | ./data | Data directory |

**Never log, never commit, always redact in audit output:**
`BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE`

---

## 6. What to build next (ordered)

1. **`packages/agent/src/perception/bitget-skills.ts`**
   Fetch signals from Bitget Skill Hub and Bitget public REST API.
   Map to the signal shape the risk engine expects:
   `{ price, change1h, change24h, fearGreed }`
   Source `change1h`, `change24h` from `spot_get_ticker` (`change24h` field).
   Source `fearGreed` equivalent from `sentiment-analyst` skill.
   Do NOT modify `engine.ts` to accept different input shapes.

2. **`packages/agent/src/execution/bitget.ts`**
   Call Bitget MCP `spot_place_order` for spot market orders.
   Read credentials from env vars.
   Redact all credentials in audit output.
   Return `{ ok, orderId?, error? }`.
   Gate behind `I_UNDERSTAND_REAL_FUNDS=yes`.

3. **Adapt `packages/agent/src/runner.ts`**
   Replace TWAK balance reading with `get_account_assets` call.
   Replace TWAK swap execution with `bitget.ts`.
   Keep all risk engine calls, overlay calls, gate calls unchanged.

4. **Update `server.js` log prefixes** `[keel]` → `[veydrift]`.

5. **Dashboard rebranding** in `apps/web/src/app/page.tsx`:
   Change "Keel" → "Veydrift"
   Change "BNB CHAIN" → "BITGET"
   Change BSC tx hash references → Bitget order ID references
   Do not change any risk logic or component structure.

6. **Deploy to Railway** and run first live cycle.

7. **Verify trading log format** matches requirements.

---

## 7. Hard rules (do not regress)

- Bitget MCP is the only thing that places orders. No other layer.
- Credentials never appear in logs, audit, errors, or committed files.
- Spot-only vocabulary everywhere.
- Never drain to zero; risk-off → USDT.
- PROTECTED FILES: `engine.ts`, `cycle.ts`, `gate.ts` — NEVER MODIFY.
- `I_UNDERSTAND_REAL_FUNDS` gate must never be bypassed in tests.
- Do not mark anything verified that was not actually tested.
