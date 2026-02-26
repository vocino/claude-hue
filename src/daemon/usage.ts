import { readFileSync, writeFileSync, existsSync } from "fs";
import type { UsageResult } from "../types.js";

/**
 * Calculate usage within a rolling time window.
 * Reads the log file, counts entries within the window, and returns the usage percentage.
 */
export function calculateUsage(
  logPath: string,
  windowMs: number,
  maxPrompts: number
): UsageResult {
  if (!existsSync(logPath)) {
    return { count: 0, percentage: 0 };
  }

  const now = Date.now();
  const cutoff = now - windowMs;
  const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);

  const recentEntries = lines.filter((line) => {
    const ts = new Date(line.trim()).getTime();
    return !isNaN(ts) && ts >= cutoff;
  });

  const count = recentEntries.length;
  const percentage = Math.min(count / maxPrompts, 1);

  return { count, percentage };
}

/**
 * Trim log entries older than the cutoff to prevent unbounded growth.
 * Keeps entries within 2x the rolling window.
 */
export function trimLog(logPath: string, windowMs: number): void {
  if (!existsSync(logPath)) return;

  const cutoff = Date.now() - windowMs * 2;
  const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);

  const kept = lines.filter((line) => {
    const ts = new Date(line.trim()).getTime();
    return !isNaN(ts) && ts >= cutoff;
  });

  writeFileSync(logPath, kept.join("\n") + (kept.length ? "\n" : ""));
}
