# Veydrift — Readiness Checklist

Status keywords: confirmed / pending / not yet tested / partial

---

## A. Bitget API connectivity — CONFIRMED

- [x] Public REST endpoint reachable from Railway — confirmed
      (code 00000, real BTC price returned)
- [x] Authenticated REST endpoint working — confirmed
      (code 00000, assets: 3 returned)
- [ ] Bitget MCP `spot_place_order` — NOT YET TESTED
- [ ] Bitget Skill Hub signals in agent — NOT YET TESTED
- [x] Bitget MCP server v1.1.0 installed — confirmed
- [x] getagent-skill v0.3.3 installed — confirmed

---

## B. Risk engine — CONFIRMED (inherited from Keel)

- [x] 3-component formula — confirmed, 293 tests passing
- [x] Mode selection — confirmed
- [x] Guardrail chain — confirmed
- [x] Kill-switch — confirmed

---

## C. Perception layer (Bitget Skill Hub) — PENDING

- [ ] `bitget-skills.ts` created — PENDING
- [ ] `technical-analysis` skill returns RSI — NOT YET TESTED
- [ ] `sentiment-analyst` skill returns Fear & Greed equivalent — NOT YET TESTED
- [ ] `macro-analyst` skill returns macro signals — NOT YET TESTED
- [ ] Signals correctly mapped to risk engine inputs — PENDING

---

## D. Execution layer (Bitget MCP) — PENDING

- [ ] `bitget.ts` created — PENDING
- [ ] `spot_place_order` executes real order — NOT YET TESTED
- [ ] `get_account_assets` returns real balance — NOT YET TESTED
- [ ] Credentials redacted in all audit output — PENDING
- [ ] `I_UNDERSTAND_REAL_FUNDS` gate working — PENDING
- [ ] Paper trading (Demo API key) — NOT YET AVAILABLE

---

## E. Runner adaptation — PENDING

- [ ] `runner.ts` reads real balance from `get_account_assets` — PENDING
- [ ] `runner.ts` uses `bitget.ts` for execution — PENDING
- [ ] First live cycle executes and logs correctly — NOT YET TESTED

---

## F. Dashboard — PARTIAL

- [x] All components built — confirmed (inherited from Keel)
- [x] Responsive layout — confirmed
- [ ] Rebranded to Veydrift — PENDING
- [ ] Shows Bitget data instead of BSC data — PENDING
- [ ] Shows Bitget order IDs as proof — PENDING

---

## G. Deployment — PARTIAL

- [x] Railway project created — confirmed
- [ ] All env vars set in Railway — PENDING
- [ ] First successful Railway deploy — PENDING
- [ ] Live cycle confirmed in Railway logs — PENDING

---

## H. Trading log — PENDING

- [ ] Live trading log generated — PENDING
- [ ] Log format: timestamp, pair, direction, price, qty,
      balance change — PENDING

---

## I. Documentation — DONE

- [x] All 9 docs updated for Veydrift — done
