export interface CieXY {
  x: number;
  y: number;
}

export interface BridgeConfig {
  ip: string;
  username: string;
}

export interface LightConfig {
  id: number;
  name: string;
}

export interface ColorConfig {
  start: CieXY;
  end: CieXY;
}

export interface BrightnessConfig {
  start: number;
  end: number;
}

export interface DaemonConfig {
  transitionMs: number;
  pollIntervalMs: number;
}

export interface ClaudeHueConfig {
  bridge: BridgeConfig;
  light: LightConfig;
  colors: ColorConfig;
  brightness: BrightnessConfig;
  daemon: DaemonConfig;
}

export interface UsageLimit {
  type: string;
  percentUsed: number;
  resetAt: string | null;
  rawType: string;
}

export interface ClaudeUsageResponse {
  limits: UsageLimit[];
  primary: UsageLimit | null;
}
