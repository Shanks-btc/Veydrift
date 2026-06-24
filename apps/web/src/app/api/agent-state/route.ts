// Server-side API route — reads persisted agent state and audit log from disk.
// Also provides portfolio summary from env vars (set alongside the runner)
// and real swap history from audit.jsonl (live entries only, dryRun excluded).

import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { AgentPersistentState, AuditEntry } from "@veydrift/shared";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.KEEL_DATA_DIR ?? resolve(process.cwd(), "../../data");
const STATE_FILE = join(DATA_DIR, "agent-state.json");

function readState(): AgentPersistentState | null {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as AgentPersistentState;
  } catch {
    return null;
  }
}

function readAudit(): AuditEntry[] {
  try {
    const raw = readFileSync(join(DATA_DIR, "audit.jsonl"), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEntry);
  } catch {
    return [];
  }
}

function parseEnvNum(key: string): number {
  const n = parseFloat(process.env[key] ?? "");
  return isNaN(n) ? 0 : n;
}

export async function GET() {
  const state = readState();
  const audit = readAudit();

  // Separate live and dry-run entries
  const liveAudit   = audit.filter((e) => e.dryRun !== true);
  const dryRunAudit = audit.filter((e) => e.dryRun === true);

  const lastEntry = liveAudit.at(-1) ?? null;
  const recentLiveAudit = liveAudit.slice(-20);  // last 20 live cycles

  // Portfolio summary — prefer env vars (set by the runner's Render config);
  // honest "unavailable" when not set (never show stale or fabricated numbers).
  const envTotal    = parseEnvNum("PORTFOLIO_VALUE_USD");
  const envVolatile = parseEnvNum("VOLATILE_VALUE_USD");
  const envStable   = parseEnvNum("STABLE_VALUE_USD") ||
                      Math.max(0, envTotal - envVolatile);

  const balanceSummary = envTotal > 0
    ? { totalUsd: envTotal, volatileUsd: envVolatile, stableUsd: envStable, source: "env" as const }
    : null;

  return NextResponse.json({
    ok: true,
    state,
    lastAuditEntry: lastEntry,
    totalCycles: audit.length,
    liveCycles: liveAudit.length,
    dryRunCycles: dryRunAudit.length,
    recentLiveAudit,
    balanceSummary,
  });
}

// POST — write riskOffOverride to agent-state.json (Force Risk-Off control)
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { riskOffOverride?: { active: boolean } };
    const current = readState();
    const next: AgentPersistentState = current ?? {
      highWaterMarkUsd: 0,
      dailyLossStartUsd: 0,
      dayLedger: {},
      lastUpdated: new Date().toISOString(),
    };

    if (body.riskOffOverride !== undefined) {
      next.riskOffOverride = {
        active: Boolean(body.riskOffOverride.active),
        setAt: new Date().toISOString(),
      };
    }
    next.lastUpdated = new Date().toISOString();

    writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
    return NextResponse.json({ ok: true, riskOffOverride: next.riskOffOverride });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
