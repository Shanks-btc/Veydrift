"use client";

import { useState, useEffect, createElement } from "react";
import type { DayAttemptEntry, AgentPersistentState } from "@veydrift/shared";
import { Card, CardHeader } from "./ui/Card";
import { fmtUsd, fmtDateTime } from "../lib/format";

interface Props {
  state: Pick<AgentPersistentState, "highWaterMarkUsd" | "dayLedger" | "lastQualifyingTradeAt"> | null;
  todayKey: string;
  isLoading: boolean;
}

type DeadlineStatus = "QUALIFIED" | "DUE_SOON" | "OVERDUE" | "BLOCKED" | "UNKNOWN";

const DEADLINE_COLORS: Record<string, string> = {
  QUALIFIED: "var(--green)",
  DUE_SOON: "var(--amber)",
  OVERDUE: "var(--red)",
  BLOCKED: "var(--red)",
};

function DeadlineBadge({
  status,
  nextDeadlineLabel,
}: {
  status: DeadlineStatus;
  nextDeadlineLabel: string | null;
}) {
  const color = DEADLINE_COLORS[status] ?? "var(--text-muted)";
  const label =
    status === "DUE_SOON" && nextDeadlineLabel
      ? "DUE_SOON — by " + nextDeadlineLabel
      : status;
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 700,
        color,
        background: color + "18",
        border: "1px solid " + color + "40",
        borderRadius: "3px",
        padding: "2px 6px",
        letterSpacing: "0.06em",
      }}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: DayAttemptEntry["status"] | null }) {
  const colorMap: Record<string, string> = {
    EXECUTED: "var(--green)",
    BLOCKED: "var(--red)",
    SKIPPED: "var(--amber)",
  };
  const color = status ? (colorMap[status] ?? "var(--text-muted)") : "var(--text-muted)";
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 700,
        color,
        background: color + "18",
        border: "1px solid " + color + "40",
        borderRadius: "3px",
        padding: "2px 6px",
        letterSpacing: "0.06em",
      }}
    >
      {status ?? "NOT RUN"}
    </span>
  );
}

// Uses createElement instead of JSX to avoid <a> tag being corrupted during copy-paste
function TxLink({ txHash }: { txHash: string }) {
  const url = "https://bscscan.com/tx/" + txHash;
  const short = txHash.slice(0, 12) + "...";
  return createElement("a", {
    href: url,
    target: "_blank",
    rel: "noopener noreferrer",
    style: {
      color: "var(--blue)",
      fontFamily: "monospace",
      textDecoration: "none",
    },
  }, short);
}

export function SchedulerStatusCard({ state, todayKey, isLoading }: Props) {
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  useEffect(() => {
    if (!isLoading || state !== null) {
      setLoadTimedOut(false);
      return;
    }
    const t = setTimeout(() => setLoadTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, [isLoading, state]);

  if (isLoading && state === null && !loadTimedOut) {
    return (
      <Card>
        <CardHeader
          title="Daily Qualification Scheduler"
          subtitle="minimum-risk qualifying attempt"
        />
        <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "8px 0" }}>
          Loading...
        </div>
      </Card>
    );
  }

  const todayEntry = state?.dayLedger[todayKey] ?? null;
  const hwm = state?.highWaterMarkUsd ?? 0;

  const lastQualAt = state?.lastQualifyingTradeAt ?? null;
  let deadlineStatus: DeadlineStatus = "UNKNOWN";
  let nextDeadlineLabel: string | null = null;

  if (lastQualAt) {
    const lastMs = new Date(lastQualAt).getTime();
    const deadlineMs = lastMs + 24 * 60 * 60 * 1000;
    const warnMs = lastMs + 20 * 60 * 60 * 1000;
    const nowMs = Date.now();
    nextDeadlineLabel = new Date(deadlineMs).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (nowMs >= deadlineMs) deadlineStatus = "OVERDUE";
    else if (nowMs >= warnMs) deadlineStatus = "DUE_SOON";
    else deadlineStatus = "QUALIFIED";
  } else if (todayEntry?.status === "BLOCKED") {
    deadlineStatus = "BLOCKED";
  }

  return (
    <Card>
      <CardHeader
        title="Daily Qualification Scheduler"
        subtitle="minimum-risk qualifying attempt"
      />

      <div
        className="scheduler-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
          marginBottom: "14px",
        }}
      >
        <div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
            {"Today (" + todayKey + ")"}
          </div>
          <StatusBadge status={todayEntry?.status ?? null} />
        </div>
        <div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
            High-water mark
          </div>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            {hwm > 0 ? fmtUsd(hwm) : "\u2014"}
          </span>
        </div>
      </div>

      {deadlineStatus !== "UNKNOWN" && (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
            24h safety check
          </div>
          <DeadlineBadge status={deadlineStatus} nextDeadlineLabel={nextDeadlineLabel} />
        </div>
      )}

      {todayEntry ? (
        <div
          style={{
            fontSize: "11px",
            color: "var(--text-secondary)",
            lineHeight: "1.6",
            paddingBottom: "10px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {todayEntry.action && (
            <div>
              {"Action: "}
              <strong style={{ color: "var(--text-primary)" }}>{todayEntry.action}</strong>
            </div>
          )}
          {todayEntry.txHash && (
            <div>
              {"Tx: "}
              <TxLink txHash={todayEntry.txHash} />
            </div>
          )}
          {todayEntry.blockedReason && (
            <div style={{ color: "var(--red)" }}>
              {"Blocked: " + todayEntry.blockedReason}
            </div>
          )}
          <div style={{ color: "var(--text-muted)", marginTop: "2px" }}>
            {fmtDateTime(todayEntry.timestamp)}
          </div>
        </div>
      ) : (
        <div
          style={{
            fontSize: "11px",
            color: "var(--text-muted)",
            paddingBottom: "10px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {"Qualification status: No qualifying attempt recorded yet."}
          <br />
          <span style={{ fontSize: "10px" }}>
            Cadence confirmation pending organizer clarification.
          </span>
        </div>
      )}

      <div
        style={{
          marginTop: "10px",
          fontSize: "10px",
          color: "var(--text-muted)",
          lineHeight: "1.4",
        }}
      >
        {"Fallback: drawdown-neutral stable-to-stable swap if the primary rotation is unavailable. Not guaranteed unless organizers confirm stable-to-stable counts. drawdown-resistant design \u2014 kill-switch and all safety gates remain active."}
      </div>
    </Card>
  );
}