"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { AuditEntry, AgentPersistentState } from "@veydrift/shared";
import { fmtUsd, fmtDateTime, fmtRelative } from "../lib/format";

// ── API response shapes ───────────────────────────────────────────────────────

interface AgentStateResponse {
  ok: boolean;
  state: AgentPersistentState | null;
  lastAuditEntry: AuditEntry | null;
  totalCycles: number;
  liveCycles: number;
  dryRunCycles: number;
  recentLiveAudit: AuditEntry[];
  balanceSummary: { totalUsd: number; volatileUsd: number; stableUsd: number; source: string } | null;
}

interface CyclePreviewResponse {
  ok: boolean;
  R: number;
  mode: string;
  snapshot: { price: number; change1h: number; change24h: number; fearGreed: number };
  priceIsSimulation: boolean;
}

interface PortfolioResponse {
  ok: boolean;
  snapshot: { portfolioUsd: number } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function modeColor(mode: string): string {
  if (mode === "Risk-on") return "var(--green)";
  if (mode === "Risk-off") return "var(--red)";
  return "var(--amber)";
}

function actionColor(action: string): string {
  if (action === "EXECUTED" || action === "FALLBACK_EXECUTED") return "var(--green)";
  if (action === "BLOCKED" || action === "KILL_SWITCH") return "var(--red)";
  return "var(--amber)";
}

function actionLabel(action: string): string {
  if (action === "FALLBACK_EXECUTED") return "EXECUTED";
  return action;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
  delay,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  delay: string;
}) {
  return (
    <div
      className="vd-card fade-in"
      style={{ animationDelay: delay }}
    >
      <div className="vd-label">{label}</div>
      <div
        className="font-mono"
        style={{
          fontSize: "22px",
          fontWeight: 700,
          color: color ?? "var(--text-primary)",
          lineHeight: 1.2,
          marginBottom: sub ? "4px" : 0,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{sub}</div>
      )}
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  delay: string;
}) {
  return (
    <div
      className="vd-card slide-in"
      style={{ animationDelay: delay, display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <div style={{ fontSize: "28px", lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
      <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.6" }}>{body}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [agentData, setAgentData] = useState<AgentStateResponse | null>(null);
  const [previewData, setPreviewData] = useState<CyclePreviewResponse | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioResponse | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [stateRes, previewRes, portfolioRes] = await Promise.all([
        fetch("/api/agent-state"),
        fetch("/api/cycle-preview"),
        fetch("/api/portfolio"),
      ]);
      if (stateRes.ok) setAgentData((await stateRes.json()) as AgentStateResponse);
      if (previewRes.ok) setPreviewData((await previewRes.json()) as CyclePreviewResponse);
      if (portfolioRes.ok) setPortfolioData((await portfolioRes.json()) as PortfolioResponse);
    } catch {
      // keep previous data on network failure
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const last = agentData?.lastAuditEntry ?? null;
  const totalValue = portfolioData?.snapshot?.portfolioUsd ?? agentData?.balanceSummary?.totalUsd ?? null;
  const liveCycles = agentData?.liveCycles ?? 0;
  const rIsFromAudit = last?.riskScore?.R != null;
  const R = last?.riskScore?.R ?? previewData?.R ?? null;
  const mode = previewData?.mode ?? last?.mode ?? null;

  // Active since: first entry in day ledger
  const dayLedger = agentData?.state?.dayLedger ?? {};
  const firstDate = Object.keys(dayLedger).sort()[0] ?? null;

  const sec = { padding: "48px var(--page-padding)", maxWidth: "1200px", margin: "0 auto" };

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* ── SECTION 1: Hero ───────────────────────────────────────────── */}
      <section
        style={{
          background: "linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%)",
          borderBottom: "1px solid var(--border)",
          padding: "72px var(--page-padding) 64px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "700px", margin: "0 auto" }}>
          <div
            className="fade-in"
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--green)",
              marginBottom: "20px",
            }}
          >
            Veydrift · Autonomous Spot Agent · Bitget
          </div>
          <h1
            className="fade-in-1"
            style={{
              fontSize: "clamp(28px, 5vw, 42px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              color: "var(--text-primary)",
              marginBottom: "20px",
            }}
          >
            Deterministic.{" "}
            <span style={{ color: "var(--green)" }}>Transparent.</span>{" "}
            Autonomous.
          </h1>
          <p
            className="fade-in-2"
            style={{
              fontSize: "16px",
              color: "var(--text-secondary)",
              lineHeight: "1.65",
              marginBottom: "36px",
            }}
          >
           
Veydrift  reads live market signals, computes a transparent three-component risk score and autonomously rebalances between volatile assets and stable assets under predefined guardrails. No LLM makes the trading decision.
          </p>
          <div
            className="fade-in-3"
            style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}
          >
            <Link href="/console" className="btn-primary">View Live Console →</Link>
            <Link href="/journal#architecture" className="btn-secondary">Read the Architecture →</Link>
          </div>
        </div>
      </section>
 
      {/* ── SECTION 2: Live Stats Bar ─────────────────────────────────── */}
      <section style={{ ...sec, paddingTop: "40px", paddingBottom: "40px" }}>
        <div className="vd-label" style={{ marginBottom: "12px" }}>Live Stats</div>
        <div className="stat-grid">
          <StatCard
            label="Portfolio Value"
            value={totalValue !== null ? fmtUsd(totalValue) : "—"}
            sub={totalValue !== null ? "From Bitget API" : "Awaiting first cycle"}
            delay="0s"
          />
          <StatCard
            label="Today's Mode"
            value={mode ?? "—"}
            sub={mode ? "Based on risk score" : "No cycle data yet"}
            color={mode ? modeColor(mode) : undefined}
            delay="0.05s"
          />
          <StatCard
            label="Live Cycles"
            value={liveCycles > 0 ? String(liveCycles) : "—"}
            sub={liveCycles > 0 ? (firstDate ? `Since ${firstDate}` : "Cycles recorded") : "Awaiting first cycle"}
            delay="0.1s"
          />
          <StatCard
            label="Risk Score R"
            value={R !== null ? R.toFixed(3) : "—"}
            sub={R !== null ? (rIsFromAudit ? "Live signals" : `${previewData?.priceIsSimulation ? "Simulated" : "Live"} signals`) : "No data yet"}
            color={
              R !== null
                ? R < 0.33
                  ? "var(--green)"
                  : R < 0.66
                  ? "var(--amber)"
                  : "var(--red)"
                : undefined
            }
            delay="0.15s"
          />
        </div>
      </section>

      {/* ── SECTION 3: Why Veydrift is different ─────────────────────── */}
      <section
        style={{
          ...sec,
          paddingTop: "40px",
          paddingBottom: "40px",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <div className="vd-label" style={{ marginBottom: "20px" }}>
          Why Veydrift is different
        </div>
        <div className="feature-grid">
          <FeatureCard
            icon={<i className="ti ti-cpu" />}
            title="Deterministic Risk Engine"
            body="Veydrift does not rely on an LLM to decide trades. It converts three live market inputs into a transparent risk score that determines how much capital can remain in volatile assets versus stablecoins."
            delay="0s"
          />
          <FeatureCard
            icon={<i className="ti ti-activity" />}
            title="Live Bitget Market Data"
            body="Veydrift reads live Bitget price movement, 24-hour momentum, funding context, and sentiment proxies to measure market risk before every rebalance."
            delay="0.1s"
          />
          <FeatureCard
            icon={<i className="ti ti-shield-check" />}
            title="Every Decision Logged"
            body="Every cycle is recorded from signal to outcome: market inputs, risk score, guardrail checks, allocation target, order result, and portfolio impact. Nothing is hidden behind a black box."
            delay="0.2s"
          />
        </div>
      </section>

      {/* ── SECTION 4: Risk Engine Formula ───────────────────────────── */}
      <section style={{ ...sec, paddingTop: "48px", paddingBottom: "48px" }}>
        <div className="vd-label" style={{ marginBottom: "20px" }}>The Formula</div>
        <div
          className="vd-card fade-in"
          style={{ marginBottom: "20px", background: "var(--card-elevated)" }}
        >
          <pre
            className="font-mono"
            style={{
              fontSize: "14px",
              color: "var(--green)",
              lineHeight: "1.8",
              margin: 0,
              overflowX: "auto",
            }}
          >
{`R = clamp(
  min(1, |Δ1h|  /  3) × 0.4    // 1h price change contribution
+ min(1, |Δ24h| / 10) × 0.4    // 24h price change contribution
+ max(0, (Sentiment − 60) / 40) × 0.2  // Fear & Greed contribution
)`}
          </pre>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "var(--grid-gap)",
          }}
        >
          {[
            { mode: "Risk-on",  threshold: "R < 0.33", target: "50% volatile",  bg: "var(--green)", text: "#000" },
            { mode: "Neutral",  threshold: "R < 0.66", target: "35% volatile",  bg: "var(--amber)", text: "#000" },
            { mode: "Risk-off", threshold: "R ≥ 0.66", target: "18% volatile",  bg: "var(--red)",   text: "#fff" },
          ].map((m) => (
            <div
              key={m.mode}
              style={{
                background: m.bg + "18",
                border: `1px solid ${m.bg}44`,
                borderRadius: "8px",
                padding: "16px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 700, color: m.bg, marginBottom: "4px" }}>
                {m.mode}
              </div>
              <div className="font-mono" style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
                {m.threshold}
              </div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)" }}>
                {m.target}
              </div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "16px", lineHeight: "1.6" }}>
          No oracle. No LLM. Fully reproducible from the same three inputs every time.
        </p>
      </section>

      {/* ── SECTION 5: Latest Decision ────────────────────────────────── */}
      <section
        style={{
          ...sec,
          paddingTop: "40px",
          paddingBottom: "40px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div className="vd-label">Latest Decision</div>
          <Link
            href="/journal"
            style={{ fontSize: "12px", color: "var(--green)", textDecoration: "none" }}
          >
            View all decisions →
          </Link>
        </div>

        {last ? (
          <div className="vd-card fade-in">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "16px",
              }}
            >
              <div>
                <div className="vd-label">Timestamp</div>
                <div style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                  {fmtDateTime(last.cycleId)}
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {fmtRelative(last.cycleId)}
                </div>
              </div>
              <div>
                <div className="vd-label">Mode</div>
                <span
                  className="mode-pill"
                  style={{
                    background: modeColor(last.mode) + "22",
                    color: modeColor(last.mode),
                    border: `1px solid ${modeColor(last.mode)}44`,
                  }}
                >
                  {last.mode}
                </span>
              </div>
              <div>
                <div className="vd-label">Action</div>
                <span
                  className="action-badge"
                  style={{
                    background: actionColor(last.action) + "22",
                    color: actionColor(last.action),
                    border: `1px solid ${actionColor(last.action)}44`,
                  }}
                >
                  {actionLabel(last.action)}
                </span>
              </div>
              <div>
                <div className="vd-label">Risk Score</div>
                <span
                  className="font-mono"
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: modeColor(last.mode),
                  }}
                >
                  {last.riskScore?.R?.toFixed(3) ?? "—"}
                </span>
              </div>
              {last.proposal?.reason && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="vd-label">Reason</div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                    {last.proposal.reason}
                  </div>
                </div>
              )}
              {last.blockedReason && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="vd-label">Blocked Reason</div>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                    {last.blockedReason}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            className="vd-card"
            style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}
          >
            <div style={{ fontSize: "28px", marginBottom: "12px" }}>◷</div>
            <div style={{ fontSize: "14px", fontWeight: 600 }}>Awaiting first cycle</div>
            <div style={{ fontSize: "12px", marginTop: "8px" }}>
              Decisions will appear here after the agent completes its first qualifier cycle.
            </div>
          </div>
        )}
      </section>

      {/* ── SECTION 6: Architecture Overview ─────────────────────────── */}
      <section style={{ ...sec, paddingTop: "48px", paddingBottom: "64px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div className="vd-label">Architecture Overview</div>
          <Link
            href="/journal#architecture"
            style={{ fontSize: "12px", color: "var(--green)", textDecoration: "none" }}
          >
            Full architecture →
          </Link>
        </div>

        <div
          className="vd-card fade-in"
          style={{ background: "var(--card-elevated)", overflow: "hidden" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              flexWrap: "wrap",
              gap: 0,
            }}
          >
            {[
              {
                step: "01",
                title: "Bitget REST API",
                items: ["ETH/BTC spot prices", "24h price change", "BTC funding rate", "Sentiment proxy", "Live market data"],
                color: "var(--blue)",
              },
              {
                step: "02",
                title: "Risk Engine",
                items: ["Compute R score", "Pick mode", "Apply overlays", "Check guardrails"],
                color: "var(--amber)",
              },
              {
                step: "03",
                title: "Bitget Execution",
                items: ["POST /spot/trade/place-order", "GET /spot/account/assets", "ETHUSDC spot pair", "HMAC-SHA256 signed"],
                color: "var(--green)",
              },
            ].map((s, i) => (
              <div
                key={s.step}
                style={{
                  flex: "1",
                  minWidth: "180px",
                  padding: "20px",
                  borderRight: i < 2 ? "1px solid var(--border)" : "none",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    color: s.color,
                    marginBottom: "8px",
                  }}
                >
                  STEP {s.step}
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: "12px",
                  }}
                >
                  {s.title}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {s.items.map((item) => (
                    <div
                      key={item}
                      style={{
                        fontSize: "12px",
                        color: "var(--text-muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span style={{ color: s.color, fontSize: "8px" }}>●</span>
                      {item}
                    </div>
                  ))}
                </div>
                {i < 2 && (
                  <div
                    style={{
                      position: "absolute",
                      right: "-12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      fontSize: "18px",
                      color: "var(--text-muted)",
                      zIndex: 1,
                      background: "var(--card-elevated)",
                      lineHeight: 1,
                    }}
                  >
                    →
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
