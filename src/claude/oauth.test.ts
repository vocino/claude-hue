import { describe, it, expect } from "vitest";
import { parseUsageResponse } from "./oauth.js";

describe("parseUsageResponse v2 — generic parser for 2026 tiers", () => {
  it("parses old shape five_hour + seven_day with utilization 0-100", () => {
    const raw = {
      five_hour: { utilization: 68, resets_at: "2026-07-25T18:00:00Z" },
      seven_day: { utilization: 42, resets_at: "2026-07-28T00:00:00Z" },
    };
    const result = parseUsageResponse(raw);
    expect(result.limits).toHaveLength(2);
    expect(result.limits.find((l) => l.type === "five_hour")!.percentUsed).toBeCloseTo(0.68);
    expect(result.limits.find((l) => l.type === "seven_day")!.percentUsed).toBeCloseTo(0.42);
    expect(result.primary?.type).toBe("five_hour");
    expect(result.primary?.percentUsed).toBeCloseTo(0.68);
  });

  it("parses new 2026 shape with monthly + harness limits", () => {
    const raw = {
      five_hour: { utilization: 22, resets_at: "2026-07-25T18:00:00Z" },
      seven_day: { utilization: 15, resets_at: "2026-07-28T00:00:00Z" },
      monthly: { utilization: 55, resets_at: "2026-08-01T00:00:00Z" },
      harness: { utilization: 30, resets_at: "2026-07-25T18:00:00Z" },
      extra: { utilization: 90 }, // overage pool — should not be primary
    };
    const result = parseUsageResponse(raw);
    expect(result.limits).toHaveLength(5);
    expect(result.primary?.type).toBe("five_hour"); // session still preferred
    expect(result.limits.find((l) => l.type === "monthly")!.percentUsed).toBeCloseTo(0.55);
    expect(result.limits.find((l) => l.type === "harness")!.percentUsed).toBeCloseTo(0.3);
  });

  it("prefers session/claude_code over weekly when five_hour absent", () => {
    const raw = {
      session: { utilization: 75, resets_at: "2026-07-25T19:00:00Z" },
      seven_day: { utilization: 40 },
    };
    const result = parseUsageResponse(raw);
    expect(result.primary?.type).toBe("session");
    expect(result.primary?.percentUsed).toBeCloseTo(0.75);
  });

  it("handles claude_code key for Max subscription (new harness tier)", () => {
    const raw = {
      claude_code: { utilization: 62, resets_at: "2026-07-25T18:00:00Z" },
      seven_day: { utilization: 30 },
    };
    const result = parseUsageResponse(raw);
    expect(result.primary?.type).toBe("claude_code");
  });

  it("handles array shape + limits[] wrapped shape (mid-2026 change)", () => {
    const wrapped = {
      limits: [
        { type: "five_hour", utilization: 68, resets_at: "2026-07-25T18:00:00Z" },
        { type: "seven_day", utilization: 42 },
      ],
    };
    const r1 = parseUsageResponse(wrapped);
    expect(r1.limits).toHaveLength(2);
    expect(r1.primary?.type).toBe("five_hour");

    const arrayShape = [
      { type: "monthly", utilization: 15 },
      { type: "harness", utilization: 22 },
    ];
    const r2 = parseUsageResponse(arrayShape);
    expect(r2.limits).toHaveLength(2);
    expect(r2.primary).toBeDefined();
  });

  it("handles percentUsed 0-1 shape (fractional) and 0-100 integer", () => {
    const raw = {
      five_hour: { percentUsed: 0.68 },
      seven_day: { percentUsed: 42 }, // some endpoints return 42 not 0.42
    };
    const result = parseUsageResponse(raw);
    expect(result.limits.find((l) => l.type === "five_hour")!.percentUsed).toBeCloseTo(0.68);
    expect(result.limits.find((l) => l.type === "seven_day")!.percentUsed).toBeCloseTo(0.42);
  });

  it("ignores extra/overage for primary unless only extra present", () => {
    const raw = {
      extra: { utilization: 95 },
      five_hour: { utilization: 10 },
    };
    const result = parseUsageResponse(raw);
    expect(result.primary?.type).toBe("five_hour");

    const onlyExtra = {
      extra: { utilization: 95 },
    };
    const r2 = parseUsageResponse(onlyExtra);
    expect(r2.primary?.type).toBe("extra");
  });

  it("returns empty limits for unrecognized shape", () => {
    const r = parseUsageResponse({});
    expect(r.limits).toHaveLength(0);
    expect(r.primary).toBeNull();
  });

  it("picks highest non-extra when no session/weekly/monthly/harness match", () => {
    const raw = {
      custom_a: { utilization: 20 },
      custom_b: { utilization: 80 },
    };
    const result = parseUsageResponse(raw);
    expect(result.primary?.percentUsed).toBeCloseTo(0.8);
  });
});
