import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  getDayKey,
  loadState,
  saveState,
  updateHwm,
  recordDayAttempt,
} from "../src/state/persistence.js";
import type { AgentPersistentState, DayAttemptEntry } from "@veydrift/shared";

// ── getDayKey ─────────────────────────────────────────────────────────────────

describe("getDayKey", () => {
  it("returns a 10-char ISO date string", () => {
    const key = getDayKey(new Date("2026-06-19T14:30:00.000Z"));
    expect(key).toBe("2026-06-19");
    expect(key).toHaveLength(10);
  });

  it("uses current date when called with no argument", () => {
    const key = getDayKey();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("different dates produce different keys", () => {
    const a = getDayKey(new Date("2026-06-19T00:00:00.000Z"));
    const b = getDayKey(new Date("2026-06-20T00:00:00.000Z"));
    expect(a).not.toBe(b);
  });
});

// ── updateHwm ─────────────────────────────────────────────────────────────────

describe("updateHwm", () => {
  it("raises HWM when current value is higher", () => {
    const state: AgentPersistentState = {
      highWaterMarkUsd: 1000,
      dailyLossStartUsd: 1000,
      dayLedger: {},
      lastUpdated: "",
    };
    updateHwm(state, 1200);
    expect(state.highWaterMarkUsd).toBe(1200);
  });

  it("does not lower HWM when current value is lower", () => {
    const state: AgentPersistentState = {
      highWaterMarkUsd: 1000,
      dailyLossStartUsd: 1000,
      dayLedger: {},
      lastUpdated: "",
    };
    updateHwm(state, 800);
    expect(state.highWaterMarkUsd).toBe(1000);
  });

  it("keeps HWM unchanged when current value equals HWM", () => {
    const state: AgentPersistentState = {
      highWaterMarkUsd: 1000,
      dailyLossStartUsd: 1000,
      dayLedger: {},
      lastUpdated: "",
    };
    updateHwm(state, 1000);
    expect(state.highWaterMarkUsd).toBe(1000);
  });
});

// ── recordDayAttempt ─────────────────────────────────────────────────────────

describe("recordDayAttempt", () => {
  it("stores the entry in dayLedger keyed by date", () => {
    const state: AgentPersistentState = {
      highWaterMarkUsd: 0,
      dailyLossStartUsd: 0,
      dayLedger: {},
      lastUpdated: "",
    };
    const entry: DayAttemptEntry = {
      date: "2026-06-19",
      status: "EXECUTED",
      action: "FALLBACK_EXECUTED",
      txHash: "0xabc",
      timestamp: "2026-06-19T12:00:00Z",
    };
    recordDayAttempt(state, entry);
    expect(state.dayLedger["2026-06-19"]).toEqual(entry);
  });

  it("overwrites an existing entry for the same date", () => {
    const state: AgentPersistentState = {
      highWaterMarkUsd: 0,
      dailyLossStartUsd: 0,
      dayLedger: {
        "2026-06-19": {
          date: "2026-06-19",
          status: "BLOCKED",
          action: "BLOCKED",
          blockedReason: "no stables",
          timestamp: "2026-06-19T08:00:00Z",
        },
      },
      lastUpdated: "",
    };
    const updated: DayAttemptEntry = {
      date: "2026-06-19",
      status: "EXECUTED",
      action: "KILL_SWITCH",
      txHash: "0xdef",
      timestamp: "2026-06-19T14:00:00Z",
    };
    recordDayAttempt(state, updated);
    expect(state.dayLedger["2026-06-19"].status).toBe("EXECUTED");
    expect(state.dayLedger["2026-06-19"].txHash).toBe("0xdef");
  });
});

// ── loadState / saveState — file I/O with temp directory ─────────────────────

describe("loadState / saveState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keel-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadState returns default state when file does not exist", () => {
    const state = loadState(tmpDir);
    expect(state.highWaterMarkUsd).toBe(0);
    expect(state.dailyLossStartUsd).toBe(0);
    expect(state.dayLedger).toEqual({});
    expect(typeof state.lastUpdated).toBe("string");
  });

  it("saveState + loadState round-trip preserves all fields", () => {
    const original: AgentPersistentState = {
      highWaterMarkUsd: 9876.54,
      dailyLossStartUsd: 9500,
      dayLedger: {
        "2026-06-19": {
          date: "2026-06-19",
          status: "EXECUTED",
          action: "EXECUTED",
          txHash: "0x99ef",
          timestamp: "2026-06-19T14:00:00Z",
        },
      },
      lastUpdated: "",
    };
    saveState(original, tmpDir);
    const loaded = loadState(tmpDir);
    expect(loaded.highWaterMarkUsd).toBe(9876.54);
    expect(loaded.dailyLossStartUsd).toBe(9500);
    expect(loaded.dayLedger["2026-06-19"].txHash).toBe("0x99ef");
  });

  it("saveState updates lastUpdated timestamp", () => {
    const before = new Date().toISOString();
    saveState(
      { highWaterMarkUsd: 0, dailyLossStartUsd: 0, dayLedger: {}, lastUpdated: "" },
      tmpDir,
    );
    const loaded = loadState(tmpDir);
    expect(loaded.lastUpdated >= before).toBe(true);
  });

  it("saveState creates the data directory if it does not exist", () => {
    const subDir = path.join(tmpDir, "nested", "data");
    saveState(
      { highWaterMarkUsd: 0, dailyLossStartUsd: 0, dayLedger: {}, lastUpdated: "" },
      subDir,
    );
    expect(fs.existsSync(subDir)).toBe(true);
  });

  it("loadState returns default state when file contains invalid JSON", () => {
    const fp = path.join(tmpDir, "agent-state.json");
    fs.writeFileSync(fp, "not json at all", "utf8");
    const state = loadState(tmpDir);
    expect(state.highWaterMarkUsd).toBe(0);
    expect(state.dayLedger).toEqual({});
  });
});
