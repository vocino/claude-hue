import type { CieXY } from "../types.js";

/**
 * Parse a hex color (#rgb, #rrggbb) to RGB 0-255.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.replace(/^#/, "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const h = match[1];
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Convert sRGB (0-255) to linear RGB (0-1).
 */
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Convert hex color to CIE xy (Hue uses this).
 * The bridge will clip to the bulb's gamut if needed.
 */
export function hexToCieXY(hex: string): CieXY | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  const x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const sum = x + y + z;
  if (sum < 1e-10) return null;
  return { x: x / sum, y: y / sum };
}

export const COLOR_PRESETS: Record<string, CieXY> = {
  green: { x: 0.2151, y: 0.7106 },
  yellow: { x: 0.4317, y: 0.5007 },
  orange: { x: 0.5562, y: 0.4084 },
  red: { x: 0.675, y: 0.322 },
  blue: { x: 0.153, y: 0.048 },
  white: { x: 0.3227, y: 0.329 },
  purple: { x: 0.2703, y: 0.1398 },
};

/**
 * Linear interpolation between two CIE xy colors.
 * t=0 returns start, t=1 returns end.
 */
export function interpolateColor(start: CieXY, end: CieXY, t: number): CieXY {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    x: start.x + (end.x - start.x) * clamped,
    y: start.y + (end.y - start.y) * clamped,
  };
}

/**
 * Linear interpolation between two brightness values (0-100).
 */
export function interpolateBrightness(
  start: number,
  end: number,
  t: number
): number {
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(start + (end - start) * clamped);
}
