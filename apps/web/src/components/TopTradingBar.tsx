"use client";

import type { AgentStatus, RiskMode } from "@veydrift/shared";
import { shortAddress, fmtRelative, modeColor } from "../lib/format";

interface Props {
  status: AgentStatus;
  mode: RiskMode;
  walletAddress: string;
  lastUpdated: string;
  onPause: () => void;
  onResume: () => void;
  onRefresh: () => void;
  paused: boolean;
}

export function TopTradingBar({
  status,
  mode,
  walletAddress,
  lastUpdated,
  onPause,
  onResume,
  onRefresh,
  paused,
}: Props) {
  const statusColor =
    status === "Running"
      ? "var(--green)"
      : status === "Paused"
      ? "var(--amber)"
      : "var(--red)";

  return (
    <div
      style={{
        backgroundColor: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        padding: "0 var(--page-padding, 24px)",
        minHeight: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "8px",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Left — wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div>
          <span
            style={{
              fontSize: "18px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Veydrift
          </span>
          <span
            className="top-bar-subtitle"
            style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              marginLeft: "8px",
              letterSpacing: "0.04em",
            }}
          >
            AUTONOMOUS SPOT AGENT · BITGET
          </span>
        </div>
      </div>

      {/* Center — status pills (hidden at ≤640px via CSS) */}
      <div
        className="top-bar-center"
        style={{ display: "flex", alignItems: "center", gap: "20px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: statusColor,
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: statusColor,
              fontFamily: "monospace",
            }}
          >
            {status.toUpperCase()}
          </span>
        </div>

        <div
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: modeColor(mode),
            background: `${modeColor(mode)}18`,
            border: `1px solid ${modeColor(mode)}40`,
            borderRadius: "4px",
            padding: "3px 8px",
            fontFamily: "monospace",
          }}
        >
          {mode.toUpperCase()}
        </div>

        <div
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            fontFamily: "monospace",
          }}
        >
          {shortAddress(walletAddress)}
        </div>

        <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          {lastUpdated && !isNaN(new Date(lastUpdated).getTime())
            ? `Updated ${fmtRelative(lastUpdated)}`
            : "Awaiting first runner update"}
        </div>
      </div>

      {/* Right — controls */}
      <div
        className="top-bar-buttons"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={paused ? onResume : onPause}
          style={{
            fontSize: "12px",
            fontWeight: 600,
            padding: "6px 14px",
            borderRadius: "5px",
            border: "1px solid var(--border)",
            background: "transparent",
            color: paused ? "var(--green)" : "var(--amber)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={onRefresh}
          style={{
            fontSize: "12px",
            fontWeight: 600,
            padding: "6px 14px",
            borderRadius: "5px",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-secondary)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}