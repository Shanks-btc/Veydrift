"use client";

import { useState, useEffect, useCallback } from "react";
import type { AuditEntry } from "@veydrift/shared";
import { fmtUsd, fmtDateTime } from "../../lib/format";

// ── API shape ─────────────────────────────────────────────────────────────────

interface AgentStateResp {
  ok: boolean;
  totalCycles: number;
  liveCycles: number;
  recentLiveAudit: AuditEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function modeColor(m: string) {
  if (m === "Risk-on")  return "var(--green)";
  if (m === "Risk-off") return "var(--red)";
  return "var(--amber)";
}

function actionColor(a: string) {
  if (a === "EXECUTED" || a === "FALLBACK_EXECUTED") return "var(--green)";
  if (a === "BLOCKED"  || a === "KILL_SWITCH")       return "var(--red)";
  return "var(--amber)";
}

function actionLabel(a: string) {
  return a === "FALLBACK_EXECUTED" ? "EXECUTED" : a;
}

function exportCSV(entries: AuditEntry[]) {
  const header =
    "timestamp,date,pair,direction,size,estimated_value_usd,action,reason,order_id,risk_score_r,mode";
  const rows = entries.map((e) => {
    const p = e.proposal;
    const pair = p ? `${p.fromAsset}/${p.toAsset}` : "—";
    const dir  = p
      ? (["USDT","USDC","USD1","FDUSD"].includes(p.fromAsset) && !["USDT","USDC","USD1","FDUSD"].includes(p.toAsset))
        ? "BUY"
        : (!["USDT","USDC","USD1","FDUSD"].includes(p.fromAsset) && ["USDT","USDC","USD1","FDUSD"].includes(p.toAsset))
        ? "SELL"
        : "REBALANCE"
      : "HOLD";
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [
      e.cycleId,
      e.date,
      pair,
      dir,
      p?.amountIn?.toFixed(4) ?? "",
      p?.estimatedValueUsd?.toFixed(2) ?? "",
      actionLabel(e.action),
      esc(p?.reason ?? e.blockedReason ?? ""),
      e.txHash ?? "",
      e.riskScore?.R?.toFixed(4) ?? "",
      e.mode,
    ].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `veydrift-journal-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Expanded row ──────────────────────────────────────────────────────────────

function ExpandedRow({ entry }: { entry: AuditEntry }) {
  const p = entry.proposal;
  return (
    <tr>
      <td
        colSpan={8}
        style={{
          background: "var(--card-elevated)",
          padding: "16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          {/* Risk components */}
          {entry.riskScore?.components && (
            <div>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
                Risk Components
              </div>
              {entry.riskScore.components.map((c) => (
                <div key={c.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)" }}>{c.label}</span>
                  <span className="font-mono" style={{ color: "var(--text-secondary)" }}>
                    {c.value.toFixed(2)} → {c.contribution.toFixed(3)}
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 700, marginTop: "6px", paddingTop: "6px", borderTop: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-muted)" }}>Total R</span>
                <span className="font-mono" style={{ color: modeColor(entry.mode) }}>
                  {entry.riskScore.R.toFixed(4)}
                </span>
              </div>
            </div>
          )}

          {/* Guardrail chain */}
          {entry.guardrailResults?.length > 0 && (
            <div>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
                Guardrails
              </div>
              {entry.guardrailResults.map((g) => (
                <div key={g.guardName} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)", textTransform: "capitalize" }}>
                    {g.guardName.replace(/-/g, " ")}
                  </span>
                  <span style={{ fontWeight: 700, color: g.ok ? "var(--green)" : "var(--red)" }}>
                    {g.ok ? "PASS" : "FAIL"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Proposal details */}
          {p && (
            <div>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
                Proposal
              </div>
              {[
                { label: "Pair",    value: `${p.fromAsset} → ${p.toAsset}` },
                { label: "Amount",  value: `${p.amountIn.toFixed(4)} ${p.fromAsset}` },
                { label: "Est. Value", value: fmtUsd(p.estimatedValueUsd) },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                  <span style={{ color: "var(--text-muted)" }}>{row.label}</span>
                  <span className="font-mono" style={{ color: "var(--text-secondary)" }}>{row.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Full reason */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "8px" }}>
              Reason
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.6" }}>
              {p?.reason ?? entry.blockedReason ?? "—"}
            </div>
            {entry.bitgetOrderId && (
              <div style={{ marginTop: "8px" }}>
                <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px" }}>Order ID</div>
                <div className="font-mono" style={{ fontSize: "11px", color: "var(--text-muted)", wordBreak: "break-all" }}>
                  {entry.bitgetOrderId}
                </div>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Bitget integrations table data ────────────────────────────────────────────

const INTEGRATIONS = [
  { name: "Bitget Skill Hub",       type: "Claude Code Skill", purpose: "Market signals aggregation",   status: "Active" },
  { name: "technical-analysis",     type: "Skill",             purpose: "RSI, trend analysis",           status: "Active" },
  { name: "sentiment-analyst",      type: "Skill",             purpose: "Fear & Greed proxy",            status: "Active" },
  { name: "macro-analyst",          type: "Skill",             purpose: "Macro event monitoring",        status: "Active" },
  { name: "market-intel",           type: "Skill",             purpose: "On-chain flow analysis",        status: "Active" },
  { name: "news-briefing",          type: "Skill",             purpose: "News sentiment scoring",        status: "Active" },
  { name: "Bitget REST API",        type: "Public REST",       purpose: "BTC/ETH spot prices",          status: "Confirmed" },
  { name: "Bitget MCP server",      type: "MCP v1.1.0",        purpose: "Order execution",               status: "Active" },
  { name: "spot_place_order",       type: "MCP Tool",          purpose: "Place spot market orders",      status: "Active" },
  { name: "get_account_assets",     type: "MCP Tool",          purpose: "Portfolio balance",             status: "Active" },
];

const GUARDRAILS = [
  { name: "Kill-switch",       desc: "Halts all trading if drawdown exceeds threshold",         threshold: "−25%" },
  { name: "Allowlist",         desc: "Only BTCUSDT · ETHUSDT spot pairs permitted",              threshold: "Pair check" },
  { name: "Per-trade cap",     desc: "Maximum single swap size as fraction of portfolio",        threshold: "25%" },
  { name: "Daily-loss cap",    desc: "Halts new risk-increasing trades if daily loss exceeded",  threshold: "5%" },
  { name: "Slippage check",    desc: "Rejects execution if realized slippage exceeds limit",     threshold: "1.0%" },
];

// ── Main page ─────────────────────────────────────────────────────────────────

type FilterAction = "ALL" | "EXECUTED" | "SKIPPED" | "BLOCKED";
type DateRange   = "TODAY" | "WEEK" | "ALL";

const PAGE_SIZE = 20;

export default function JournalPage() {
  const [entries,    setEntries]   = useState<AuditEntry[]>([]);
  const [loading,    setLoading]   = useState(true);
  const [filter,     setFilter]    = useState<FilterAction>("ALL");
  const [dateRange,  setDateRange] = useState<DateRange>("ALL");
  const [page,       setPage]      = useState(0);
  const [expanded,   setExpanded]  = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent-state");
      if (res.ok) {
        const data = (await res.json()) as AgentStateResp;
        setEntries(data.recentLiveAudit ?? []);
      }
    } catch { /* keep previous */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // ── Client-side filtering ───────────────────────────────────────────────────
  const now = Date.now();
  const DAY_MS  = 86_400_000;
  const WEEK_MS = 7 * DAY_MS;

  const filtered = entries.filter((e) => {
    // Action filter
    if (filter !== "ALL") {
      const isExecuted = e.action === "EXECUTED" || e.action === "FALLBACK_EXECUTED";
      const isBlocked  = e.action === "BLOCKED" || e.action === "KILL_SWITCH";
      const isSkipped  = e.action === "SKIPPED";
      if (filter === "EXECUTED" && !isExecuted) return false;
      if (filter === "BLOCKED"  && !isBlocked)  return false;
      if (filter === "SKIPPED"  && !isSkipped)  return false;
    }
    // Date range filter
    if (dateRange !== "ALL") {
      const age = now - new Date(e.cycleId).getTime();
      if (dateRange === "TODAY" && age > DAY_MS)  return false;
      if (dateRange === "WEEK"  && age > WEEK_MS) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const STABLES = new Set(["USDT", "USDC", "USD1", "FDUSD"]);

  function getDirection(e: AuditEntry): string {
    const p = e.proposal;
    if (!p) return "HOLD";
    if (STABLES.has(p.fromAsset) && !STABLES.has(p.toAsset)) return "BUY";
    if (!STABLES.has(p.fromAsset) && STABLES.has(p.toAsset)) return "SELL";
    return "REBALANCE";
  }

  const sec: React.CSSProperties = {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "40px var(--page-padding)",
  };

  const filterBtn = (label: string, val: FilterAction) => (
    <button
      key={val}
      onClick={() => { setFilter(val); setPage(0); }}
      style={{
        padding: "6px 14px",
        fontSize: "12px",
        fontWeight: 600,
        borderRadius: "4px",
        border: "1px solid",
        cursor: "pointer",
        borderColor: filter === val ? "var(--green)" : "var(--border)",
        background:   filter === val ? "var(--green)18" : "none",
        color:        filter === val ? "var(--green)"   : "var(--text-muted)",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );

  const dateBtn = (label: string, val: DateRange) => (
    <button
      key={val}
      onClick={() => { setDateRange(val); setPage(0); }}
      style={{
        padding: "6px 14px",
        fontSize: "12px",
        fontWeight: 600,
        borderRadius: "4px",
        border: "1px solid",
        cursor: "pointer",
        borderColor: dateRange === val ? "var(--blue)" : "var(--border)",
        background:   dateRange === val ? "var(--blue)18" : "none",
        color:        dateRange === val ? "var(--blue)"   : "var(--text-muted)",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* ── SECTION 1: Trade Journal ─────────────────────────────── */}
      <section id="journal" style={sec}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "24px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "6px" }}>
              Trade Journal
            </div>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              Autonomous Decision Log
            </h1>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
              {entries.length} cycle{entries.length !== 1 ? "s" : ""} recorded
            </div>
          </div>
          <button
            className="btn-secondary"
            onClick={() => exportCSV(filtered)}
            disabled={filtered.length === 0}
            style={{ fontSize: "13px" }}
          >
            ↓ Export CSV
          </button>
        </div>

        {/* Filters */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "16px",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {filterBtn("All",      "ALL")}
            {filterBtn("Executed", "EXECUTED")}
            {filterBtn("Skipped",  "SKIPPED")}
            {filterBtn("Blocked",  "BLOCKED")}
          </div>
          <div style={{ width: "1px", height: "24px", background: "var(--border)", margin: "0 4px" }} />
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {dateBtn("Today",    "TODAY")}
            {dateBtn("7 Days",   "WEEK")}
            {dateBtn("All time", "ALL")}
          </div>
          <div style={{ marginLeft: "auto", fontSize: "12px", color: "var(--text-muted)" }}>
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Audit table */}
        <div className="vd-card" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)" }}>
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>◷</div>
              <div style={{ fontSize: "14px", fontWeight: 600 }}>No trades recorded yet</div>
              <div style={{ fontSize: "12px", marginTop: "8px" }}>
                Cycles will appear here after the agent executes its first qualifying trade.
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="vd-table" style={{ minWidth: "700px" }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Mode</th>
                    <th>Action</th>
                    <th className="hide-mobile">Pair</th>
                    <th className="hide-mobile">Dir</th>
                    <th className="hide-mobile">Size</th>
                    <th>Reason</th>
                    <th className="hide-mobile">Order ID</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((e) => (
                    <>
                      <tr
                        key={e.cycleId}
                        onClick={() => setExpanded(expanded === e.cycleId ? null : e.cycleId)}
                        style={{ cursor: "pointer" }}
                      >
                        <td className="font-mono" style={{ fontSize: "12px", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                          {fmtDateTime(e.cycleId)}
                        </td>
                        <td>
                          <span
                            className="mode-pill"
                            style={{
                              background: modeColor(e.mode) + "22",
                              color: modeColor(e.mode),
                              border: `1px solid ${modeColor(e.mode)}44`,
                              fontSize: "10px",
                            }}
                          >
                            {e.mode}
                          </span>
                        </td>
                        <td>
                          <span
                            className="action-badge"
                            style={{
                              background: actionColor(e.action) + "22",
                              color: actionColor(e.action),
                              border: `1px solid ${actionColor(e.action)}44`,
                              fontSize: "10px",
                            }}
                          >
                            {actionLabel(e.action)}
                          </span>
                        </td>
                        <td className="font-mono hide-mobile" style={{ fontSize: "12px" }}>
                          {e.proposal
                            ? `${e.proposal.toAsset}/${e.proposal.fromAsset}`
                            : "—"}
                        </td>
                        <td className="hide-mobile" style={{ fontSize: "12px" }}>
                          {getDirection(e)}
                        </td>
                        <td className="font-mono hide-mobile" style={{ fontSize: "12px" }}>
                          {e.proposal ? `${e.proposal.amountIn.toFixed(2)} ${e.proposal.fromAsset}` : "—"}
                        </td>
                        <td
                          style={{
                            maxWidth: "220px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: "12px",
                            color: "var(--text-muted)",
                          }}
                        >
                          {e.proposal?.reason ?? e.blockedReason ?? "—"}
                        </td>
                        <td className="font-mono hide-mobile" style={{ fontSize: "11px" }}>
                          {e.bitgetOrderId
                            ? `${e.bitgetOrderId.slice(0, 12)}…`
                            : "—"}
                        </td>
                      </tr>
                      {expanded === e.cycleId && <ExpandedRow key={`${e.cycleId}-exp`} entry={e} />}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "8px",
                padding: "16px",
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                className="btn-secondary"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{ padding: "6px 14px", fontSize: "12px" }}
              >
                ← Prev
              </button>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                {page + 1} / {totalPages}
              </span>
              <button
                className="btn-secondary"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{ padding: "6px 14px", fontSize: "12px" }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── SECTION 2: Architecture & Proof ──────────────────────── */}
      <section
        id="architecture"
        style={{
          ...sec,
          paddingTop: "40px",
          paddingBottom: "60px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "6px" }}>
          Architecture & Proof
        </div>
        <h2 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "32px" }}>
          System Design & Verified Integrations
        </h2>

        {/* 2a: Bitget Integrations */}
        <div style={{ marginBottom: "40px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "12px" }}>
            Bitget Integrations
          </div>
          <div className="vd-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="vd-table">
                <thead>
                  <tr>
                    <th>Integration</th>
                    <th>Type</th>
                    <th className="hide-mobile">Purpose</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {INTEGRATIONS.map((row) => (
                    <tr key={row.name}>
                      <td style={{ color: "var(--text-primary)", fontWeight: 500, fontFamily: "monospace", fontSize: "12px" }}>
                        {row.name}
                      </td>
                      <td style={{ fontSize: "12px" }}>{row.type}</td>
                      <td className="hide-mobile" style={{ fontSize: "12px", color: "var(--text-muted)" }}>{row.purpose}</td>
                      <td>
                        <span style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          color: row.status === "Active" || row.status === "Confirmed" ? "var(--green)" : "var(--amber)",
                        }}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 2b: Risk Engine */}
        <div style={{ marginBottom: "40px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "12px" }}>
            Risk Engine
          </div>
          <div className="vd-card" style={{ background: "var(--card-elevated)" }}>
            <pre className="font-mono" style={{ fontSize: "13px", color: "var(--green)", lineHeight: "1.8", margin: 0, overflowX: "auto" }}>
{`R = clamp(
  min(1, |Δ1h|  /  3) × 0.4   // 1h change contribution  (0 – 0.4)
+ min(1, |Δ24h| / 10) × 0.4   // 24h change contribution (0 – 0.4)
+ max(0, (FG − 60) / 40) × 0.2  // Sentiment contribution (0 – 0.2)
)`}
            </pre>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--grid-gap)", marginTop: "16px" }}>
              {[
                { mode: "Risk-on",  threshold: "R < 0.33", target: "50% volatile", bg: "var(--green)" },
                { mode: "Neutral",  threshold: "R < 0.66", target: "35% volatile", bg: "var(--amber)" },
                { mode: "Risk-off", threshold: "R ≥ 0.66", target: "18% volatile", bg: "var(--red)" },
              ].map((m) => (
                <div key={m.mode} style={{ textAlign: "center", padding: "10px", background: m.bg + "18", borderRadius: "6px", border: `1px solid ${m.bg}44` }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: m.bg }}>{m.mode}</div>
                  <div className="font-mono" style={{ fontSize: "11px", color: "var(--text-muted)" }}>{m.threshold}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{m.target}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 2c: Guardrail Chain */}
        <div style={{ marginBottom: "40px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "12px" }}>
            Guardrail Chain
          </div>
          <div className="vd-card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="vd-table">
              <thead>
                <tr>
                  <th>Guardrail</th>
                  <th>Description</th>
                  <th>Threshold</th>
                </tr>
              </thead>
              <tbody>
                {GUARDRAILS.map((g, i) => (
                  <tr key={g.name}>
                    <td style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "10px", marginRight: "6px" }}>{i + 1}.</span>
                      {g.name}
                    </td>
                    <td style={{ fontSize: "12px" }}>{g.desc}</td>
                    <td className="font-mono" style={{ fontSize: "12px", color: "var(--amber)" }}>{g.threshold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 2d: Verified API Proof */}
        <div style={{ marginBottom: "40px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "12px" }}>
            Verified API Proof
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[
              {
                icon: "✓",
                color: "var(--green)",
                text: "Bitget public API: confirmed reachable — code 00000, BTC price fetched successfully",
              },
              {
                icon: "✓",
                color: "var(--green)",
                text: "Bitget authenticated API: confirmed working — code 00000, account assets returned",
              },
              {
                icon: "✓",
                color: "var(--green)",
                text: "Bitget MCP server: v1.1.0 installed — spot_place_order and get_account_assets tools confirmed",
              },
              {
                icon: "✓",
                color: "var(--green)",
                text: "HMAC-SHA256 signing: message = timestamp + method + path + body — verified against live API",
              },
              {
                icon: "✓",
                color: "var(--green)",
                text: "Dry-run mode: I_UNDERSTAND_REAL_FUNDS gate implemented — no funds moved without explicit opt-in",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="vd-card"
                style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "12px 16px" }}
              >
                <span style={{ color: item.color, fontWeight: 700, fontSize: "14px", marginTop: "1px", flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 2e: Links */}
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "12px" }}>
            Links
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a
              href="https://github.com/Shanks-btc/Veydrift"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ fontSize: "13px" }}
            >
              GitHub →
            </a>
            <span className="btn-secondary" style={{ fontSize: "13px", cursor: "default", opacity: 0.6 }}>
              Live Dashboard — deploy pending
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
