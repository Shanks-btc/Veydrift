"use client";

import { useState } from "react";
import type { AgentStatus, DrawdownGateResult, RiskMode } from "@veydrift/shared";
import { SCORING_COST_PER_SWAP_LEG } from "@veydrift/shared";
import { Card, CardHeader } from "./ui/Card";
import { modeColor } from "../lib/format";

interface Props {
  status: AgentStatus;
  riskOffActive?: boolean;
  onPause: () => void;
  onResume: () => void;
  onRefresh: () => void;
}

interface CyclePreview {
  ok: boolean;
  priceIsSimulation?: boolean;
  direction?: string;
  R?: number;
  mode?: RiskMode;
  targetVolatilePct?: number;
  adjustedTarget?: number;
  emergencyMode?: boolean;
  overlaysApplied?: string[];
  drawdownPct?: number;
  drawdownGate?: DrawdownGateResult;
  proposal?: { fromAsset: string; toAsset: string; rationale: string };
  note?: string;
  error?: string;
}

function Btn({
  onClick,
  color,
  disabled,
  children,
}: {
  onClick: () => void;
  color: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        borderRadius: "6px",
        border: `1px solid ${color}50`,
        backgroundColor: disabled ? "var(--surface)" : `${color}12`,
        color: disabled ? "var(--text-muted)" : color,
        fontSize: "12px",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.15s",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = `${color}22`;
      }}
      onMouseLeave={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = `${color}12`;
      }}
    >
      {children}
    </button>
  );
}

export function AgentControls({ status, riskOffActive, onPause, onResume, onRefresh }: Props) {
  const isPaused = status === "Paused";
  const [preview, setPreview] = useState<CyclePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  async function runPreview() {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch("/api/cycle-preview");
      const data = (await res.json()) as CyclePreview;
      setPreview(data);
    } catch (err) {
      setPreview({ ok: false, error: String(err) });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function runRotatePreview() {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch("/api/cycle-preview?direction=to-stable");
      const data = (await res.json()) as CyclePreview;
      setPreview(data);
    } catch (err) {
      setPreview({ ok: false, error: String(err) });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function setRiskOffOverride(active: boolean) {
    setOverrideLoading(true);
    setOverrideError(null);
    try {
      const res = await fetch("/api/agent-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riskOffOverride: { active } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onRefresh();
    } catch (err) {
      setOverrideError(String(err));
    } finally {
      setOverrideLoading(false);
    }
  }

  const gateOk = preview?.drawdownGate?.ok;
  const gateColor =
    gateOk === true
      ? "var(--green)"
      : gateOk === false
      ? "var(--red)"
      : "var(--border)";

  return (
    <Card>
      <CardHeader
        title="Risk-Gated Agent Controls"
        subtitle="Daily qualification scheduler"
      />

      {/* Primary action buttons */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
        {isPaused ? (
          <Btn onClick={onResume} color="var(--green)">
            ▶ Resume scheduler
          </Btn>
        ) : (
          <Btn onClick={onPause} color="var(--amber)">
            ⏸ Pause scheduler
          </Btn>
        )}
        <Btn onClick={runPreview} color="var(--blue)" disabled={previewLoading}>
          {previewLoading ? "Computing…" : "Preview next cycle"}
        </Btn>
        <Btn onClick={onRefresh} color="var(--text-secondary)">
          ↺ Refresh
        </Btn>
      </div>

      {/* Force Risk-Off override row */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px", alignItems: "center" }}>
        {riskOffActive ? (
          <Btn
            onClick={() => void setRiskOffOverride(false)}
            color="var(--red)"
            disabled={overrideLoading}
          >
            {overrideLoading ? "Clearing…" : "✕ Clear Risk-Off Override"}
          </Btn>
        ) : (
          <Btn
            onClick={() => void setRiskOffOverride(true)}
            color="var(--amber)"
            disabled={overrideLoading}
          >
            {overrideLoading ? "Setting…" : "⬇ Force Risk-Off"}
          </Btn>
        )}
        <Btn onClick={runRotatePreview} color="var(--blue)" disabled={previewLoading}>
          {previewLoading ? "Computing…" : "Preview Rotate to Stables"}
        </Btn>
      </div>

      {riskOffActive && (
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--amber)",
            background: "var(--amber)10",
            border: "1px solid var(--amber)35",
            borderRadius: "4px",
            padding: "6px 10px",
            marginBottom: "10px",
          }}
        >
          Force Risk-Off active — next live cycle will not increase volatile exposure
          (stable→volatile proposals suppressed; fallback qualification attempt used instead).
          Cleared automatically after one live cycle executes.
        </div>
      )}

      {overrideError && (
        <div style={{ fontSize: "11px", color: "var(--red)", marginBottom: "8px" }}>
          Override error: {overrideError}
        </div>
      )}

      <div
        style={{
          fontSize: "10px",
          color: "var(--text-muted)",
          lineHeight: "1.5",
          marginBottom: preview ? "10px" : "0",
        }}
      >
        Pause halts the daily qualification scheduler. The risk engine continues to compute.
        All safety gates remain active (kill-switch → allowlist → per-trade cap → daily-loss
        cap → slippage → projected-drawdown). Holdings are NOT flattened on pause.
        Force Risk-Off suppresses risk-increasing trades for one live cycle — drawdown-neutral
        fallback qualification attempt (USDT→USDC) is used instead.
        <br />
        Execution requires the scheduler running server-side with{" "}
        <code style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>
          I_UNDERSTAND_REAL_FUNDS=yes
        </code>
        . Preview only — no trade is submitted here.
      </div>

      {preview && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
          {preview.priceIsSimulation && (
            <div
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "var(--amber)",
                letterSpacing: "0.06em",
                marginBottom: "8px",
              }}
            >
              SIMULATION — market snapshot is not live CMC data
            </div>
          )}

          {preview.direction === "to-stable" && preview.proposal ? (
            <>
              <div style={{ fontSize: "12px", marginBottom: "8px" }}>
                <span style={{ color: "var(--text-muted)" }}>Proposed rotation: </span>
                <strong style={{ fontFamily: "monospace" }}>
                  {preview.proposal.fromAsset} → {preview.proposal.toAsset}
                </strong>
              </div>
              {preview.drawdownGate && (
                <div
                  style={{
                    fontSize: "11px",
                    padding: "6px 8px",
                    borderRadius: "4px",
                    background: "var(--green)10",
                    border: "1px solid var(--green)35",
                    marginBottom: "8px",
                  }}
                >
                  <strong style={{ color: "var(--green)" }}>
                    Drawdown gate (§4): PASS
                  </strong>
                  <div style={{ color: "var(--text-secondary)", marginTop: "2px", lineHeight: "1.4" }}>
                    {preview.drawdownGate.reason}
                  </div>
                </div>
              )}
              {preview.note && (
                <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                  {preview.note}
                </div>
              )}
            </>
          ) : preview.ok !== false ? (
            <>
              {/* className="preview-grid" collapses to 1 col on small screens */}
              <div
                className="preview-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "6px",
                  fontSize: "12px",
                  marginBottom: "8px",
                }}
              >
                <div>
                  <span style={{ color: "var(--text-muted)" }}>R score: </span>
                  <strong style={{ color: "var(--text-primary)" }}>
                    {preview.R?.toFixed(3)}
                  </strong>
                </div>
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Mode: </span>
                  <strong style={{ color: modeColor(preview.mode ?? "Neutral") }}>
                    {preview.mode}
                  </strong>
                </div>
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Base target: </span>
                  <strong>{preview.targetVolatilePct}% volatile</strong>
                </div>
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Adjusted: </span>
                  <strong>{preview.adjustedTarget}%</strong>
                </div>
              </div>

              {(preview.overlaysApplied?.length ?? 0) > 0 && (
                <div style={{ fontSize: "11px", color: "var(--amber)", marginBottom: "6px" }}>
                  Overlays: {preview.overlaysApplied?.join(", ")}
                </div>
              )}

              {preview.emergencyMode && (
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--red)",
                    fontWeight: 600,
                    marginBottom: "6px",
                  }}
                >
                  Emergency mode active — no new volatile exposure permitted
                </div>
              )}

              {preview.drawdownGate && (
                <div
                  style={{
                    fontSize: "11px",
                    padding: "6px 8px",
                    borderRadius: "4px",
                    background: `${gateColor}10`,
                    border: `1px solid ${gateColor}35`,
                  }}
                >
                  <strong style={{ color: gateColor }}>
                    Drawdown gate (§4): {preview.drawdownGate.ok ? "PASS" : "BLOCK"}
                  </strong>
                  <div
                    style={{
                      color: "var(--text-secondary)",
                      marginTop: "2px",
                      lineHeight: "1.4",
                    }}
                  >
                    {preview.drawdownGate.reason}
                  </div>
                  {preview.drawdownGate.projectedVolatilePct !== undefined && (
                    <div style={{ color: "var(--text-muted)", marginTop: "2px" }}>
                      Projected volatile: {preview.drawdownGate.projectedVolatilePct.toFixed(1)}%
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: "11px", color: "var(--red)" }}>
              Preview error: {preview.error}
            </div>
          )}

          <div
            style={{
              fontSize: "11px",
              color: "var(--text-secondary)",
              marginTop: "8px",
              padding: "5px 8px",
              borderRadius: "4px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              fontFamily: "monospace",
            }}
          >
            Competition scoring deduction:{" "}
            <strong>{(SCORING_COST_PER_SWAP_LEG * 100).toFixed(3)}% per swap leg</strong>
            {" "}· 2-leg swap = {(SCORING_COST_PER_SWAP_LEG * 2 * 100).toFixed(3)}% total
            <span style={{ color: "var(--text-muted)", fontFamily: "sans-serif", fontSize: "10px" }}>
              {" "}(display only — not used in gates or safety checks)
            </span>
          </div>

          <div
            style={{
              fontSize: "10px",
              color: "var(--text-muted)",
              marginTop: "8px",
              lineHeight: "1.4",
            }}
          >
            Preview runs: risk engine → drawdown-gate (§4). Real execution also adds:
            kill-switch → allowlist → per-trade cap → daily-loss cap → slippage.
            Only TWAK submits trades. Eligible tokens: ETH, CAKE, LINK, USDT, USDC, USD1,
            FDUSD. BNB is gas-only.
          </div>
        </div>
      )}
    </Card>
  );
}