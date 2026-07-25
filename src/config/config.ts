import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ClaudeHueConfig } from "../types.js";

export const CONFIG_DIR = join(homedir(), ".claude-hue");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const PID_PATH = join(CONFIG_DIR, "daemon.pid");

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function isValidConfig(obj: unknown): obj is ClaudeHueConfig {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (!o.bridge || typeof o.bridge !== "object") return false;
  if (!o.light || typeof o.light !== "object") return false;
  if (!o.colors || typeof o.colors !== "object") return false;
  const bridge = o.bridge as Record<string, unknown>;
  if (typeof bridge.ip !== "string" || !bridge.ip) return false;
  if (typeof bridge.username !== "string" || !bridge.username) return false;
  const light = o.light as Record<string, unknown>;
  if (typeof light.id !== "number") return false;
  return true;
}

export function loadConfig(): ClaudeHueConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config not found at ${CONFIG_PATH}. Run "claude-hue setup" first.`
    );
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Config at ${CONFIG_PATH} is not valid JSON. Delete it and run "claude-hue setup" again.`
    );
  }
  if (!isValidConfig(parsed)) {
    throw new Error(
      `Config at ${CONFIG_PATH} is missing required fields. Delete it and run "claude-hue setup" again.`
    );
  }
  return parsed;
}

export function saveConfig(config: ClaudeHueConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}
