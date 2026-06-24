import type { X402Confirmation } from "@veydrift/shared";
import { fmtRelative } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

export function X402ConfirmationCard({ data }: { data: X402Confirmation }) {
  const hasPaid = data.totalConfirmed > 0;

  return (
    <Card>
      <CardHeader title="x402 Confirmation" subtitle="Rationed pay-per-call" />

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "8px",
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            fontSize: "28px",
            fontWeight: 700,
            fontFamily: "monospace",
            color: hasPaid ? "var(--blue)" : "var(--text-muted)",
          }}
        >
          {data.totalConfirmed}
        </span>
        <span
          style={{ fontSize: "13px", color: "var(--text-secondary)" }}
        >
          confirmed call{data.totalConfirmed !== 1 ? "s" : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {[
          {
            label: "Settlement Chain",
            value: data.settlementChain,
            color: "var(--blue)",
          },
          {
            label: "Last Amount",
            value: hasPaid
              ? `$${(data.lastAmountUsdc ?? 0).toFixed(2)} USDC`
              : "—",
            color: "var(--text-primary)",
          },
          {
            label: "Last Confirmed",
            value: hasPaid && data.lastConfirmedAt
              ? fmtRelative(data.lastConfirmedAt)
              : "Not yet executed",
            color: hasPaid ? "var(--text-primary)" : "var(--text-muted)",
          },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {label}
            </span>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "monospace",
                color,
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {!hasPaid && (
        <div
          style={{
            marginTop: "12px",
            padding: "8px",
            borderRadius: "5px",
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          Wallet funded on Base — awaiting first real paid call
        </div>
      )}
    </Card>
  );
}
