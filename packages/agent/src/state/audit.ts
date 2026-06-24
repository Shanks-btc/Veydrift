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
