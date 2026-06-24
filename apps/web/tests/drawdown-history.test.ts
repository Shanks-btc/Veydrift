import { describe, it, expect } from "vitest";
import { applyDrawdownPoint, MAX_HISTORY } from "../src/lib/drawdown-history";
import type { DrawdownPoint } from "@veydrift/shared";

function pt(timestamp: string, drawdownPct: number): DrawdownPoint {
  return { timestamp, drawdownPct };
}

// ── append behavior ───────────────────────────────────────────────────────────

describe("applyDrawdownPoint — append behavior", () => {
  it("adds the first entry to an empty history", () => {
    const result = applyDrawdownPoint([], pt("2026-06-21T00:00:00.000Z", -1.5));
    expect(result).toHaveLength(1);
    expect(result[0].drawdownPct).toBe(-1.5);
  });

  it("appends a new entry to existing history", () => {
    const history = [pt("2026-06-21T00:00:00.000Z", -1.0)];
    const result  = applyDrawdownPoint(history, pt("2026-06-21T01:00:00.000Z", -2.0));
    expect(result).toHaveLength(2);
    expect(result[1].drawdownPct).toBe(-2.0);
  });

  it("preserves all earlier entries unchanged", () => {
    const h = [
      pt("2026-06-21T00:00:00.000Z", -1.0),
      pt("2026-06-21T01:00:00.000Z", -2.0),
    ];
    const result = applyDrawdownPoint(h, pt("2026-06-21T02:00:00.000Z", -3.0));
    expect(result[0]).toEqual(h[0]);
    expect(result[1]).toEqual(h[1]);
    expect(result[2].drawdownPct).toBe(-3.0);
  });

  it("does not mutate the input array", () => {
    const history = [pt("2026-06-21T00:00:00.000Z", 0)];
    const before  = history.length;
    applyDrawdownPoint(history, pt("2026-06-21T01:00:00.000Z", -1));
    expect(history).toHaveLength(before);
  });
});

// ── deduplication ─────────────────────────────────────────────────────────────

describe("applyDrawdownPoint — deduplication by timestamp", () => {
  it("skips an entry whose timestamp matches the last entry", () => {
    const ts = "2026-06-21T00:00:00.000Z";
    const history = [pt(ts, -1.0)];
    const result  = applyDrawdownPoint(history, pt(ts, -1.0));
    expect(result).toHaveLength(1);
    expect(result).toBe(history); // same reference — nothing written
  });

  it("returns the SAME array reference on a duplicate (safe no-write signal)", () => {
    const ts      = "2026-06-21T05:00:00.000Z";
    const history = [pt("2026-06-21T04:00:00.000Z", -0.5), pt(ts, -1.2)];
    const result  = applyDrawdownPoint(history, pt(ts, -1.2));
    expect(result).toBe(history);
  });

  it("does NOT skip when only an earlier entry has the same timestamp (only last matters)", () => {
    const dupTs   = "2026-06-21T00:00:00.000Z";
    const history = [
      pt(dupTs,                     -1.0),   // same ts as new point, but NOT the last entry
      pt("2026-06-21T01:00:00.000Z", -2.0),  // last entry has different ts
    ];
    const result = applyDrawdownPoint(history, pt(dupTs, -1.0));
    expect(result).toHaveLength(3); // appended — only last-entry ts is checked
  });

  it("appends a new entry when only the second-to-last has the same timestamp", () => {
    const history = [
      pt("2026-06-21T00:00:00.000Z", -0.5),
      pt("2026-06-21T01:00:00.000Z", -1.0),
    ];
    const newPt = pt("2026-06-21T02:00:00.000Z", -1.5);
    const result = applyDrawdownPoint(history, newPt);
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual(newPt);
  });
});

// ── 200-entry bound ───────────────────────────────────────────────────────────

describe("applyDrawdownPoint — 200-entry bound", () => {
  it("MAX_HISTORY is 200", () => {
    expect(MAX_HISTORY).toBe(200);
  });

  it("stays at 200 when appending to a full history", () => {
    const history = Array.from({ length: MAX_HISTORY }, (_, i) =>
      pt(`2026-06-01T${String(i).padStart(2, "0")}:00:00.000Z`, -i * 0.1),
    );
    const result = applyDrawdownPoint(history, pt("2026-06-10T00:00:00.000Z", -99));
    expect(result).toHaveLength(MAX_HISTORY);
  });

  it("the 201st entry causes the oldest entry to drop", () => {
    const oldest = pt("2026-06-01T00:00:00.000Z", -0.1);
    const history = [
      oldest,
      ...Array.from({ length: MAX_HISTORY - 1 }, (_, i) =>
        pt(`2026-06-02T${String(i).padStart(2, "0")}:00:00.000Z`, -(i + 1) * 0.1),
      ),
    ];
    expect(history).toHaveLength(MAX_HISTORY);

    const newest = pt("2026-06-10T12:00:00.000Z", -5.5);
    const result = applyDrawdownPoint(history, newest);

    expect(result).toHaveLength(MAX_HISTORY);
    expect(result[result.length - 1]).toEqual(newest);   // newest is last
    expect(result[0]).not.toEqual(oldest);               // oldest was dropped
    expect(result.find((p) => p.timestamp === oldest.timestamp)).toBeUndefined();
  });

  it("never grows beyond MAX_HISTORY regardless of how many entries are added", () => {
    let history: DrawdownPoint[] = [];
    for (let i = 0; i < MAX_HISTORY + 50; i++) {
      history = applyDrawdownPoint(
        history,
        pt(`2026-06-${String(Math.floor(i / 24) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00.000Z`, -i * 0.05),
      );
    }
    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY);
    expect(history).toHaveLength(MAX_HISTORY);
  });

  it("accepts a custom maxEntries limit", () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      pt(`2026-06-01T0${i}:00:00.000Z`, -i * 0.1),
    );
    const result = applyDrawdownPoint(history, pt("2026-06-01T06:00:00.000Z", -0.6), 5);
    expect(result).toHaveLength(5);
    expect(result[result.length - 1].drawdownPct).toBeCloseTo(-0.6);
  });
});
