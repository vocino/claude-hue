import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { calculateUsage, trimLog } from "./usage.js";

const TEST_DIR = join(tmpdir(), "claude-hue-test-" + process.pid);
const LOG_PATH = join(TEST_DIR, "usage.log");

function writeLog(timestamps: Date[]): void {
  writeFileSync(LOG_PATH, timestamps.map((d) => d.toISOString()).join("\n") + "\n");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("calculateUsage", () => {
  const WINDOW = 5 * 60 * 60 * 1000; // 5 hours
  const MAX = 45;

  it("returns 0 when log does not exist", () => {
    const result = calculateUsage("/nonexistent/path", WINDOW, MAX);
    expect(result).toEqual({ count: 0, percentage: 0 });
  });

  it("returns 0 for an empty log", () => {
    writeFileSync(LOG_PATH, "");
    const result = calculateUsage(LOG_PATH, WINDOW, MAX);
    expect(result).toEqual({ count: 0, percentage: 0 });
  });

  it("counts entries within the rolling window", () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 60_000); // 1 min ago
    const old = new Date(now.getTime() - WINDOW - 60_000); // outside window
    writeLog([old, recent, now]);

    const result = calculateUsage(LOG_PATH, WINDOW, MAX);
    expect(result.count).toBe(2);
    expect(result.percentage).toBeCloseTo(2 / 45);
  });

  it("caps percentage at 1.0", () => {
    const now = new Date();
    const entries = Array.from({ length: 60 }, (_, i) =>
      new Date(now.getTime() - i * 1000)
    );
    writeLog(entries);

    const result = calculateUsage(LOG_PATH, WINDOW, MAX);
    expect(result.count).toBe(60);
    expect(result.percentage).toBe(1);
  });
});

describe("trimLog", () => {
  const WINDOW = 5 * 60 * 60 * 1000;

  it("removes entries older than 2x window", () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 60_000);
    const veryOld = new Date(now.getTime() - WINDOW * 3);
    writeLog([veryOld, recent, now]);

    trimLog(LOG_PATH, WINDOW);

    const result = calculateUsage(LOG_PATH, WINDOW, 100);
    expect(result.count).toBe(2);
  });

  it("handles nonexistent file gracefully", () => {
    expect(() => trimLog("/nonexistent/path", WINDOW)).not.toThrow();
  });
});
