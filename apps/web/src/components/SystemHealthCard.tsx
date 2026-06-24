import type { HealthItem } from "@veydrift/shared";
import { healthColor } from "../lib/format";
import { Card, CardHeader } from "./ui/Card";

const statusLabels: Record<string, string> = {
  ok: "OK",
  warn: "WARN",
  error: "ERR",
  not_yet_verified: "—",
};

export function SystemHealthCard({ data }: { data: HealthItem[] }) {
  return (
    <Card>
      <CardHeader title="System Health" />
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {data.map((item) => {
          const col = healthColor(item.status);
          return (
            <div
              key={item.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px",
                borderRadius: "5px",
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: col,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
              <span
                className="health-detail"
                style={{
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                  textAlign: "right",
                  maxWidth: "160px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flexShrink: 1,
                }}
                title={item.detail}
              >
                {item.detail}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: col,
                  fontFamily: "monospace",
                  minWidth: "28px",
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {statusLabels[item.status]}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}