// §5 — Append-only JSONL audit log.
// One JSON line per scheduler cycle. Never modifies existing entries.

import * as fs from "fs";
import * as path from "path";
import type { AuditEntry } from "@veydrift/shared";

const AUDIT_FILE = "audit.jsonl";

export function appendAuditEntry(
  entry: AuditEntry,
  dataDir = "./data",
): void {
  const fp = path.join(dataDir, AUDIT_FILE);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.appendFileSync(fp, JSON.stringify(entry) + "\n", "utf8");
}

// Patch a single audit entry by cycleId (in-place line rewrite).
// Used only to add bitgetOrderId after the async order response arrives —
// the scheduler writes the entry optimistically before the real orderId is known.
export function patchAuditEntry(
  cycleId: string,
  patch: Partial<AuditEntry>,
  dataDir = "./data",
): void {
  const fp = path.join(dataDir, AUDIT_FILE);
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const lines = raw.split("\n");
    const updated = lines.map((line) => {
      if (!line.trim()) return line;
      try {
        const entry = JSON.parse(line) as AuditEntry;
        if (entry.cycleId === cycleId) {
          return JSON.stringify({ ...entry, ...patch });
        }
      } catch { /* skip malformed lines */ }
      return line;
    });
    fs.writeFileSync(fp, updated.join("\n"), "utf8");
  } catch {
    // Patch failure is non-fatal — orderId will be absent from this audit entry
  }
}

export function readAuditLog(dataDir = "./data"): AuditEntry[] {
  const fp = path.join(dataDir, AUDIT_FILE);
  try {
    return fs
      .readFileSync(fp, "utf8")
      .split("\n")
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as AuditEntry);
  } catch {
    return [];
  }
}
