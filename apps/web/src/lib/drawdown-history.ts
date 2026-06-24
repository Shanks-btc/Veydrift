// Pure array logic for the bounded drawdown history time series.
// No file I/O — route.ts wraps this with read/write. Exported so tests can
// exercise the transformation without touching the filesystem.

import type { DrawdownPoint } from "@veydrift/shared";

export const MAX_HISTORY = 200;

/**
 * Returns the updated history array after conditionally appending `point`.
 *
 * Rules:
 *   - Deduplicates by checking only the *last* entry's timestamp: same
 *     timestamp means the same cycle is being re-read (cache hit or rapid
 *     refresh), so no new entry is added.
 *   - Bounded to `maxEntries`: when the new array would exceed the limit,
 *     the oldest entries are dropped (slice from the right).
 *
 * Pure: does not mutate the input array, always returns a new reference.
 */
export function applyDrawdownPoint(
  history: DrawdownPoint[],
  point: DrawdownPoint,
  maxEntries = MAX_HISTORY,
): DrawdownPoint[] {
  if (history.length > 0 && history[history.length - 1].timestamp === point.timestamp) {
    return history;
  }
  return [...history, point].slice(-maxEntries);
}
