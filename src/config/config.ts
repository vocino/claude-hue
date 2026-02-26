import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ClaudeHueConfig } from "../types.js";

export const CONFIG_DIR = join(homedir(), ".claude-hue");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const USAGE_LOG_PATH = join(CONFIG_DIR, "usage.log");
export const PID_PATH = join(CONFIG_DIR, "daemon.pid");

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): ClaudeHueConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config not found at ${CONFIG_PATH}. Run "claude-hue setup" first.`
    );
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as ClaudeHueConfig;
}

export function saveConfig(config: ClaudeHueConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}
