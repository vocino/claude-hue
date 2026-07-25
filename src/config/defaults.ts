import type { ColorConfig, BrightnessConfig, DaemonConfig } from "../types.js";
import { COLOR_PRESETS } from "../hue/color.js";

export const DEFAULT_COLORS: ColorConfig = {
  start: COLOR_PRESETS.green,
  end: COLOR_PRESETS.red,
};

export const DEFAULT_BRIGHTNESS: BrightnessConfig = {
  start: 100,
  end: 100,
};

export const DEFAULT_DAEMON: DaemonConfig = {
  transitionMs: 2000,
  // 5 min to avoid 429 on /api/oauth/usage — see https://github.com/anthropics/claude-code/issues/31021
  pollIntervalMs: 300_000,
};
