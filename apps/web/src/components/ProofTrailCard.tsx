import type { ProofEntry } from "@veydrift/shared";
import { fmtRelative, shortHash } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

const typeColors: Record<string, string> = {
  Decision: "var(--amber)",
  SwapExecution: "var(--green)",
  x402Confirmation: "var(--blue)",
  AgentIdentity: "var(--text-secondary)",
  Network: "var(--text-muted)",
};

export function ProofTrailCard({ data }: { data: ProofEntry[] }) {
  return (
    <Card>
      <CardHeader title="Proof Trail" subtitle="On-chain evidence per action" />
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {data.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "flex-start",
              paddingBottom: "10px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {/* Status dot */}
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: entry.verified ? typeColors[entry.type] : "var(--border)",
                marginTop: "4px",
                flexShrink: 0,
                border: entry.verified ? "none" : "1px solid var(--text-muted)",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: entry.verified ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {entry.label}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--text-muted)",
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtRelative(entry.timestamp)}
                </span>
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                  marginTop: "2px",
                }}
              >
                {entry.detail}
              </div>
              {entry.txHash && entry.explorerUrl && (
                <a
                  href={entry.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: "11px",
                    color: "var(--blue)",
                    fontFamily: "monospace",
                    textDecoration: "none",
                    display: "block",
                    marginTop: "2px",
                  }}
                >
                  {shortHash(entry.txHash)} ↗
                </a>
              )}
            </div>
            {!entry.verified && (
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--text-muted)",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "3px",
                  padding: "1px 5px",
                  whiteSpace: "nowrap",
                }}
              >
                pending
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
