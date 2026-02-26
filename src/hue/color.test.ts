import { describe, it, expect } from "vitest";
import { interpolateColor, interpolateBrightness, COLOR_PRESETS } from "./color.js";

describe("interpolateColor", () => {
  const green = COLOR_PRESETS.green;
  const red = COLOR_PRESETS.red;

  it("returns start color at t=0", () => {
    const result = interpolateColor(green, red, 0);
    expect(result.x).toBeCloseTo(green.x);
    expect(result.y).toBeCloseTo(green.y);
  });

  it("returns end color at t=1", () => {
    const result = interpolateColor(green, red, 1);
    expect(result.x).toBeCloseTo(red.x);
    expect(result.y).toBeCloseTo(red.y);
  });

  it("returns midpoint at t=0.5", () => {
    const result = interpolateColor(green, red, 0.5);
    expect(result.x).toBeCloseTo((green.x + red.x) / 2);
    expect(result.y).toBeCloseTo((green.y + red.y) / 2);
  });

  it("clamps t below 0", () => {
    const result = interpolateColor(green, red, -0.5);
    expect(result.x).toBeCloseTo(green.x);
    expect(result.y).toBeCloseTo(green.y);
  });

  it("clamps t above 1", () => {
    const result = interpolateColor(green, red, 1.5);
    expect(result.x).toBeCloseTo(red.x);
    expect(result.y).toBeCloseTo(red.y);
  });
});

describe("interpolateBrightness", () => {
  it("returns start at t=0", () => {
    expect(interpolateBrightness(100, 50, 0)).toBe(100);
  });

  it("returns end at t=1", () => {
    expect(interpolateBrightness(100, 50, 1)).toBe(50);
  });

  it("returns midpoint at t=0.5", () => {
    expect(interpolateBrightness(100, 50, 0.5)).toBe(75);
  });

  it("clamps t", () => {
    expect(interpolateBrightness(100, 50, -1)).toBe(100);
    expect(interpolateBrightness(100, 50, 2)).toBe(50);
  });
});
