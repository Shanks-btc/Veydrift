// §5 — HWM + per-day attempt ledger persistence.
//
// Atomic writes (tmp → rename) so a crash mid-write never corrupts state.
// loadState returns a default state when the file is missing or corrupt.

import * as fs from "fs";
import * as path from "path";
import type { AgentPersistentState, DayAttemptEntry, PortfolioSnapshot } from "@veydrift/shared";

export const DEFAULT_DATA_DIR = "./data";
const STATE_FILE = "agent-state.json";
const SNAPSHOT_FILE = "portfolio-snapshot.json";

function emptyState(): AgentPersistentState {
  return {
    highWaterMarkUsd: 0,
    dailyLossStartUsd: 0,
    dayLedger: {},
    lastUpdated: new Date().toISOString(),
  };
}

// Returns "2026-06-19" for a given date (UTC).
export function getDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function loadState(dataDir = DEFAULT_DATA_DIR): AgentPersistentState {
  const fp = path.join(dataDir, STATE_FILE);
  try {
    const raw = fs.readFileSync(fp, "utf8");
    return JSON.parse(raw) as AgentPersistentState;
  } catch {
    return emptyState();
  }
}

export function saveState(
  state: AgentPersistentState,
  dataDir = DEFAULT_DATA_DIR,
): void {
  const fp = path.join(dataDir, STATE_FILE);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const updated: AgentPersistentState = { ...state, lastUpdated: new Date().toISOString() };
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

// Raises HWM if current portfolio value sets a new high. Mutates in place.
export function updateHwm(
  state: AgentPersistentState,
  currentValueUsd: number,
): void {
  if (currentValueUsd > state.highWaterMarkUsd) {
    state.highWaterMarkUsd = currentValueUsd;
  }
}

// Records the day's attempt in the ledger. Mutates in place.
export function recordDayAttempt(
  state: AgentPersistentState,
  entry: DayAttemptEntry,
): void {
  state.dayLedger[entry.date] = entry;
}

export function writePortfolioSnapshot(
  snapshot: PortfolioSnapshot,
  dataDir = DEFAULT_DATA_DIR,
): void {
  const fp = path.join(dataDir, SNAPSHOT_FILE);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

export function readPortfolioSnapshot(
  dataDir = DEFAULT_DATA_DIR,
): PortfolioSnapshot | null {
  try {
    const fp = path.join(dataDir, SNAPSHOT_FILE);
    return JSON.parse(fs.readFileSync(fp, "utf8")) as PortfolioSnapshot;
  } catch {
    return null;
  }
}
