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

export interface UsageConfig {
  maxPrompts: number;
  windowMs: number;
}

export interface DaemonConfig {
  transitionMs: number;
  pollIntervalMs: number;
}

export interface ClaudeAuthConfig {
  cookie: string;
  orgId: string;
}

export interface ClaudeHueConfig {
  bridge: BridgeConfig;
  light: LightConfig;
  colors: ColorConfig;
  brightness: BrightnessConfig;
  usage: UsageConfig;
  daemon: DaemonConfig;
  claude?: ClaudeAuthConfig;
}

export interface UsageResult {
  count: number;
  percentage: number;
}
