import type { ColorConfig, BrightnessConfig, UsageConfig, DaemonConfig } from "../types.js";

export const COLOR_PRESETS = {
  green: { x: 0.2151, y: 0.7106 },
  yellow: { x: 0.4317, y: 0.5007 },
  orange: { x: 0.5562, y: 0.4084 },
  red: { x: 0.675, y: 0.322 },
  blue: { x: 0.153, y: 0.048 },
  white: { x: 0.3227, y: 0.329 },
  purple: { x: 0.2703, y: 0.1398 },
} as const;

export const DEFAULT_COLORS: ColorConfig = {
  start: COLOR_PRESETS.green,
  end: COLOR_PRESETS.red,
};

export const DEFAULT_BRIGHTNESS: BrightnessConfig = {
  start: 100,
  end: 100,
};

export const DEFAULT_USAGE: UsageConfig = {
  maxPrompts: 45,
  windowMs: 5 * 60 * 60 * 1000, // 5 hours
};

export const DEFAULT_DAEMON: DaemonConfig = {
  transitionMs: 2000,
  pollIntervalMs: 60_000, // 1 minute
};
