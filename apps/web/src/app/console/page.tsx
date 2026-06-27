"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AuditEntry, AgentPersistentState, PortfolioSnapshot, PortfolioFreshness } from "@veydrift/shared";
import { fmtUsd, fmtPct, fmtDateTime, fmtRelative } from "../../lib/format";

// ── API shapes ────────────────────────────────────────────────────────────────

interface AgentStateResp {
  ok: boolean;
  state: AgentPersistentState | null;
  lastAuditEntry: AuditEntry | null;
  totalCycles: number;
  liveCycles: number;
  dryRunCycles: number;
  recentLiveAudit: AuditEntry[];
  balanceSummary: { totalUsd: number; volatileUsd: number; stableUsd: number } | null;
}

interface PortfolioResp {
  ok: boolean;
  snapshot: PortfolioSnapshot | null;
  freshness: PortfolioFreshness;
  source: string;
}

interface PreviewResp {
  ok: boolean;
  R: number;
  mode: string;
  targetVolatilePct: number;
  snapshot: { price: number; change1h: number; change24h: number; fearGreed: number };
  priceIsSimulation: boolean;
  killSwitchGate:  { ok: boolean; guardName: string; reason: string };
  allowlistGate:   { ok: boolean; guardName: string; reason: string };
  perTradeCapGate: { ok: boolean; guardName: string; reason: string };
  slippageGate:    { ok: boolean; guardName: string; reason: string };
  drawdownGate:    { ok: boolean; guardName: string; reason: string };
  outcome: string;
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

function fgLabel(fg: number) {
  if (fg <= 25) return "Extreme Fear";
  if (fg <= 45) return "Fear";
  if (fg <= 55) return "Neutral";
  if (fg <= 75) return "Greed";
  return "Extreme Greed";
}

function fgColor(fg: number) {
  if (fg <= 35) return "var(--red)";
  if (fg <= 55) return "var(--amber)";
  return "var(--green)";
}

// ── Shared card shell ─────────────────────────────────────────────────────────

function Panel({ title, children, badge }: { title: string; children: React.ReactNode; badge?: string }) {
  return (
    <div className="vd-card" style={{ marginBottom: "var(--grid-gap)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
          paddingBottom: "10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          {title}
        </div>
        {badge && (
          <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.06em" }}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function KV({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{label}</span>
      <span
        className={mono ? "font-mono" : ""}
        style={{ fontSize: "13px", fontWeight: 600, color: color ?? "var(--text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}

function GateRow({ gate }: { gate: { ok: boolean; guardName: string; reason: string } }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: "12px", color: "var(--text-secondary)", textTransform: "capitalize" }}>
        {gate.guardName.replace(/-/g, " ")}
      </span>
      <span style={{ fontSize: "11px", fontWeight: 700, color: gate.ok ? "var(--green)" : "var(--red)" }}>
        {gate.ok ? "PASS" : "FAIL"}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const REFRESH_MS = 30_000;

export default function ConsolePage() {
  const [agentData,   setAgentData]   = useState<AgentStateResp | null>(null);
  const [portData,    setPortData]    = useState<PortfolioResp | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResp | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [secondsAgo,  setSecondsAgo]  = useState(0);
  const lastFetchRef = useRef<number>(Date.now());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes, prRes] = await Promise.all([
        fetch("/api/agent-state"),
        fetch("/api/portfolio"),
        fetch("/api/cycle-preview"),
      ]);
      if (sRes.ok)  setAgentData(  (await sRes.json())  as AgentStateResp);
      if (pRes.ok)  setPortData(   (await pRes.json())   as PortfolioResp);
      if (prRes.ok) setPreviewData((await prRes.json()) as PreviewResp);
    } catch { /* keep previous */ }
    finally {
      setLoading(false);
      lastFetchRef.current = Date.now();
      setSecondsAgo(0);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const dataTimer   = setInterval(fetchAll, REFRESH_MS);
    const tickTimer   = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastFetchRef.current) / 1000));
    }, 1000);
    return () => { clearInterval(dataTimer); clearInterval(tickTimer); };
  }, [fetchAll]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const snap     = portData?.snapshot ?? null;
  const last     = agentData?.lastAuditEntry ?? null;
  const recent   = agentData?.recentLiveAudit ?? [];
  const state    = agentData?.state;
  const preview  = previewData;
  const balance  = agentData?.balanceSummary ?? null;

  const totalUsd    = snap?.portfolioUsd ?? balance?.totalUsd ?? null;
  const volatileUsd = balance?.volatileUsd ?? null;
  const stableUsd   = balance?.stableUsd ?? null;
  const allocation  = snap?.allocation ?? null;
  const hwm         = snap?.hwm ?? state?.highWaterMarkUsd ?? 0;
  const drawdownPct = snap?.currentDrawdownPct ?? 0;

  const DRAW_WARN = -12;
  const DRAW_KILL = -25;
  const drawColor = drawdownPct <= DRAW_KILL ? "var(--red)" : drawdownPct <= -8 ? "var(--amber)" : "var(--green)";

  const R    = last?.riskScore?.R ?? preview?.R ?? null;
  const mode = preview?.mode ?? last?.mode ?? null;

  const ethPrice  = preview?.snapshot?.price ?? null;
  const fearGreed = preview?.snapshot?.fearGreed ?? null;
  const change24h = preview?.snapshot?.change24h ?? null;
  const change1h  = preview?.snapshot?.change1h ?? null;

  const riskComponents = last?.riskScore?.components ?? null;

  const gates = preview
    ? [
        preview.killSwitchGate,
        preview.allowlistGate,
        preview.perTradeCapGate,
        preview.slippageGate,
        preview.drawdownGate,
      ]
    : [];

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* ── Top status bar ─────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          padding: "10px var(--page-padding)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Live Console
          </span>
          {mode && (
            <span
              className="mode-pill"
              style={{
                background: modeColor(mode) + "22",
                color: modeColor(mode),
                border: `1px solid ${modeColor(mode)}44`,
              }}
            >
              {mode}
            </span>
          )}
          {R !== null && (
            <span className="font-mono" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              R = {R.toFixed(3)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "11px", color: loading ? "var(--amber)" : "var(--text-muted)" }}>
            {loading ? "Refreshing…" : `Updated ${secondsAgo}s ago`}
          </span>
          <button
            onClick={() => { void fetchAll(); }}
            className="nav-btn"
            style={{ fontSize: "13px" }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "var(--grid-gap) var(--page-padding)",
        }}
      >
        <div className="console-grid">

          {/* ── LEFT COLUMN ─────────────────────────────────────────── */}
          <div>

            {/* Panel 1: Portfolio Status */}
            <Panel title="Portfolio Status" badge={portData?.freshness}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                <div>
                  <div className="vd-label">Total Value</div>
                  <div className="font-mono" style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-primary)" }}>
                    {totalUsd !== null ? fmtUsd(totalUsd) : "—"}
                  </div>
                </div>
                <div>
                  <div className="vd-label">Drawdown</div>
                  <div className="font-mono" style={{ fontSize: "28px", fontWeight: 700, color: drawColor }}>
                    {drawdownPct !== 0 ? fmtPct(drawdownPct) : "—"}
                  </div>
                </div>
              </div>
              {allocation && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                  {[
                    { label: "Volatile", pct: allocation.volatilePct, color: "var(--blue)" },
                    { label: "Stable",   pct: allocation.stablePct,   color: "var(--green)" },
                    { label: "Gas",      pct: allocation.gasPct,       color: "var(--text-muted)" },
                  ].map((a) => (
                    <div key={a.label}>
                      <div className="vd-label">{a.label}</div>
                      <div className="font-mono" style={{ fontSize: "16px", fontWeight: 700, color: a.color }}>
                        {a.pct.toFixed(1)}%
                      </div>
                      <div className="progress-track" style={{ marginTop: "4px" }}>
                        <div className="progress-fill" style={{ width: `${Math.min(100, a.pct)}%`, background: a.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {snap?.snapshotAt && (
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "12px" }}>
                  Snapshot: {fmtRelative(snap.snapshotAt)}
                </div>
              )}
            </Panel>

            {/* Panel 2: Spot Holdings */}
            <Panel title="Spot Holdings" badge="ETHUSDC · Bitget spot">
              {(() => {
                const balances = snap?.tokenBalances ?? {};
                const entries = Object.entries(balances);
                if (entries.length === 0) {
                  return (
                    <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: "13px" }}>
                      {totalUsd !== null
                        ? `Total: ${fmtUsd(totalUsd)} · Bitget balance USD-aggregated (per-token detail pending)`
                        : "Awaiting first cycle — holdings will appear here"}
                    </div>
                  );
                }
                return (
                  <div style={{ overflowX: "auto" }}>
                    <table className="vd-table">
                      <thead>
                        <tr>
                          <th>Asset</th>
                          <th>Balance</th>
                          <th>USD Value</th>
                          <th className="hide-mobile">Alloc %</th>
                          <th className="hide-mobile">24h</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map(([asset, data]) => {
                          const allPct = totalUsd && totalUsd > 0 ? (data.valueUsd / totalUsd) * 100 : 0;
                          const chg = data.change24hPct ?? null;
                          return (
                            <tr key={asset}>
                              <td style={{ color: "var(--text-primary)", fontWeight: 600 }}>{asset}</td>
                              <td className="font-mono">{data.balance.toFixed(4)}</td>
                              <td className="font-mono">{fmtUsd(data.valueUsd)}</td>
                              <td className="font-mono hide-mobile">{allPct.toFixed(1)}%</td>
                              <td
                                className="font-mono hide-mobile"
                                style={{ color: chg === null ? "var(--text-muted)" : chg >= 0 ? "var(--green)" : "var(--red)" }}
                              >
                                {chg === null ? "—" : fmtPct(chg)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
              {/* Summary row when we have USD aggregates but no per-token */}
              {volatileUsd !== null && stableUsd !== null && Object.keys(snap?.tokenBalances ?? {}).length === 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
                  <div style={{ background: "var(--card-elevated)", borderRadius: "6px", padding: "10px" }}>
                    <div className="vd-label">BTC + ETH</div>
                    <div className="font-mono" style={{ fontSize: "16px", fontWeight: 700 }}>
                      {fmtUsd(volatileUsd)}
                    </div>
                  </div>
                  <div style={{ background: "var(--card-elevated)", borderRadius: "6px", padding: "10px" }}>
                    <div className="vd-label">USDT</div>
                    <div className="font-mono" style={{ fontSize: "16px", fontWeight: 700 }}>
                      {fmtUsd(stableUsd)}
                    </div>
                  </div>
                </div>
              )}
            </Panel>

            {/* Panel 3: Drawdown Guardrail */}
            <Panel title="Drawdown Guardrail">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                <div>
                  <div className="vd-label">Current Drawdown</div>
                  <div className="font-mono" style={{ fontSize: "24px", fontWeight: 700, color: drawColor }}>
                    {drawdownPct !== 0 ? fmtPct(drawdownPct) : "—"}
                  </div>
                </div>
                <div>
                  <div className="vd-label">High-Water Mark</div>
                  <div className="font-mono" style={{ fontSize: "24px", fontWeight: 700 }}>
                    {hwm > 0 ? fmtUsd(hwm) : "—"}
                  </div>
                </div>
              </div>
              {/* Progress bar toward limits */}
              <div style={{ marginBottom: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>0%</span>
                  <span style={{ fontSize: "11px", color: "var(--amber)" }}>Alert {DRAW_WARN}%</span>
                  <span style={{ fontSize: "11px", color: "var(--red)" }}>Kill {DRAW_KILL}%</span>
                </div>
                <div className="progress-track" style={{ height: "8px" }}>
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(100, (Math.abs(drawdownPct) / Math.abs(DRAW_KILL)) * 100)}%`,
                      background: drawColor,
                    }}
                  />
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Alert at {DRAW_WARN}% · Kill-switch at {DRAW_KILL}%
              </div>
            </Panel>
          </div>

          {/* ── RIGHT COLUMN ────────────────────────────────────────── */}
          <div>

            {/* Panel 4: Market Signals */}
            <Panel
              title="Market Signals — Preview"
              badge={preview?.priceIsSimulation ? "SIMULATED" : "LIVE"}
            >
              {[
                { label: "ETH Price (est.)", value: ethPrice !== null ? fmtUsd(ethPrice) : "—", mono: true },
                { label: "ETH 24h",       value: change24h !== null ? fmtPct(change24h)                                          : "—",     mono: true,  color: change24h !== null ? (change24h >= 0 ? "var(--green)" : "var(--red)") : undefined },
                { label: "ETH 1h",        value: change1h  !== null ? fmtPct(change1h)                                           : "—",     mono: true,  color: change1h  !== null ? (change1h  >= 0 ? "var(--green)" : "var(--red)") : undefined },
                { label: "Sentiment",     value: fearGreed !== null ? `${fearGreed.toFixed(0)} — ${fgLabel(fearGreed)}`         : "—",     color: fearGreed !== null ? fgColor(fearGreed) : undefined },
                { label: "Funding Rate",  value: "BTC Perps proxy",   color: "var(--text-muted)" },
              ].map((row) => (
                <KV key={row.label} label={row.label} value={row.value} color={row.color} mono={row.mono} />
              ))}
            </Panel>

            {/* Panel 5: Risk Score */}
            <Panel title="Risk Score Breakdown">
              <div style={{ textAlign: "center", marginBottom: "16px" }}>
                <div
                  className="font-mono"
                  style={{
                    fontSize: "48px",
                    fontWeight: 700,
                    lineHeight: 1,
                    color: R !== null ? (R < 0.33 ? "var(--green)" : R < 0.66 ? "var(--amber)" : "var(--red)") : "var(--text-muted)",
                  }}
                >
                  {R !== null ? R.toFixed(3) : "—"}
                </div>
                {mode && (
                  <div style={{ marginTop: "8px" }}>
                    <span
                      className="mode-pill"
                      style={{
                        background: modeColor(mode) + "22",
                        color: modeColor(mode),
                        border: `1px solid ${modeColor(mode)}44`,
                        fontSize: "13px",
                        padding: "4px 14px",
                      }}
                    >
                      {mode}
                    </span>
                  </div>
                )}
              </div>

              {/* Component bars */}
              {riskComponents ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                  {riskComponents.map((c) => (
                    <div key={c.label}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{c.label}</span>
                        <span className="font-mono" style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                          {c.contribution.toFixed(3)}
                        </span>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${(c.contribution / 0.4) * 100}%`,
                            background: "var(--blue)",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : preview ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                  {[
                    { label: "1h Change",      val: Math.min(0.4, (Math.abs(preview.snapshot.change1h)  / 3)  * 0.4) },
                    { label: "24h Change",     val: Math.min(0.4, (Math.abs(preview.snapshot.change24h) / 10) * 0.4) },
                    { label: "Fear & Greed",   val: Math.max(0,   ((preview.snapshot.fearGreed - 60) / 40)    * 0.2) },
                  ].map((c) => (
                    <div key={c.label}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{c.label}</span>
                        <span className="font-mono" style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                          {c.val.toFixed(3)}
                        </span>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${(c.val / 0.4) * 100}%`, background: "var(--blue)" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center" }}>
                R = Σ(components) · clamp(0, 1)
              </div>
            </Panel>

            {/* Panel 6: Latest Decision */}
            <Panel title="Latest Autonomous Decision">
              {last ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                    <div>
                      <div className="vd-label">Time</div>
                      <div style={{ fontSize: "12px", color: "var(--text-primary)" }}>{fmtDateTime(last.cycleId)}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{fmtRelative(last.cycleId)}</div>
                    </div>
                    <div>
                      <div className="vd-label">Result</div>
                      <span
                        className="action-badge"
                        style={{
                          background: actionColor(last.action) + "22",
                          color: actionColor(last.action),
                          border: `1px solid ${actionColor(last.action)}44`,
                        }}
                      >
                        {last.action === "FALLBACK_EXECUTED" ? "EXECUTED" : last.action}
                      </span>
                    </div>
                  </div>
                  {last.proposal?.reason && (
                    <div style={{ marginBottom: "12px" }}>
                      <div className="vd-label">Reason</div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                        {last.proposal.reason.length > 160
                          ? last.proposal.reason.slice(0, 160) + "…"
                          : last.proposal.reason}
                      </div>
                    </div>
                  )}
                  {last.txHash && (
                    <div style={{ marginBottom: "12px" }}>
                      <div className="vd-label">Order ID</div>
                      <div className="font-mono" style={{ fontSize: "11px", color: "var(--text-muted)", wordBreak: "break-all" }}>
                        {last.txHash}
                      </div>
                    </div>
                  )}
                  {/* Gate chain */}
                  {gates.length > 0 && (
                    <>
                      <div className="vd-label" style={{ marginBottom: "6px" }}>Gate Chain</div>
                      {gates.map((g) => <GateRow key={g.guardName} gate={g} />)}
                    </>
                  )}
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: "13px" }}>
                  Awaiting first cycle
                </div>
              )}
            </Panel>
          </div>
        </div>

        {/* ── BOTTOM: Recent Decisions Log ───────────────────────── */}
        <div className="vd-card" style={{ marginTop: "var(--grid-gap)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
              paddingBottom: "10px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Recent Decisions
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Last {Math.min(recent.length, 10)} cycles
            </span>
          </div>
          {recent.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)", fontSize: "13px" }}>
              No cycles recorded yet
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="vd-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Mode</th>
                    <th className="hide-mobile">R Score</th>
                    <th>Action</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {[...recent].reverse().slice(0, 10).map((entry) => (
                    <tr key={entry.cycleId}>
                      <td className="font-mono" style={{ whiteSpace: "nowrap", fontSize: "12px" }}>
                        {fmtDateTime(entry.cycleId)}
                      </td>
                      <td>
                        <span
                          className="mode-pill"
                          style={{
                            background: modeColor(entry.mode) + "22",
                            color: modeColor(entry.mode),
                            border: `1px solid ${modeColor(entry.mode)}44`,
                            fontSize: "10px",
                          }}
                        >
                          {entry.mode}
                        </span>
                      </td>
                      <td className="font-mono hide-mobile" style={{ fontSize: "12px" }}>
                        {entry.riskScore?.R?.toFixed(3) ?? "—"}
                      </td>
                      <td>
                        <span
                          className="action-badge"
                          style={{
                            background: actionColor(entry.action) + "22",
                            color: actionColor(entry.action),
                            border: `1px solid ${actionColor(entry.action)}44`,
                            fontSize: "10px",
                          }}
                        >
                          {entry.action === "FALLBACK_EXECUTED" ? "EXECUTED" : entry.action}
                        </span>
                      </td>
                      <td
                        style={{
                          maxWidth: "280px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: "12px",
                          color: "var(--text-muted)",
                        }}
                      >
                        {entry.proposal?.reason ?? entry.blockedReason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
