import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { loadConfig, PID_PATH, ensureConfigDir } from "../config/config.js";
import { interpolateColor, interpolateBrightness } from "../hue/color.js";
import { setLightColor } from "../hue/light.js";
import {
  getClaudeCodeOAuthToken,
  fetchUsageViaOAuth,
  OAuthUsageError,
} from "../claude/oauth.js";
import type { ClaudeHueConfig } from "../types.js";

let running = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let consecutiveErrors = 0;
let currentBackoffMs = 0;
let lastKnownPct: number | null = null;

function writePid(): void {
  writeFileSync(PID_PATH, process.pid.toString());
}
function removePid(): void {
  try {
    if (existsSync(PID_PATH)) unlinkSync(PID_PATH);
  } catch {}
}
export function readPid(): number | null {
  try {
    if (!existsSync(PID_PATH)) return null;
    const pid = parseInt(readFileSync(PID_PATH, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}
export function isDaemonRunning(): boolean {
  const pid = readPid();
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    removePid();
    return false;
  }
}
export function stopDaemon(): void {
  if (!isDaemonRunning()) {
    console.log("Daemon is not running.");
    return;
  }
  const pid = readPid();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Stopped daemon (PID ${pid})`);
    } catch {
      console.log("Failed to stop daemon, removing stale PID file.");
    }
  }
  removePid();
}

async function updateLight(config: ClaudeHueConfig, percentage: number): Promise<void> {
  const color = interpolateColor(config.colors.start, config.colors.end, percentage);
  const brightness = interpolateBrightness(
    config.brightness.start,
    config.brightness.end,
    percentage
  );
  await setLightColor(
    config.bridge.ip,
    config.bridge.username,
    config.light.id,
    color,
    brightness,
    config.daemon.transitionMs
  );
}

async function pollOnce(config: ClaudeHueConfig): Promise<void> {
  const token = getClaudeCodeOAuthToken();
  if (!token) {
    if (consecutiveErrors === 0) {
      console.warn(`[${new Date().toISOString()}] No OAuth token. Run 'claude login' in Claude Code CLI. Keeping last light state.`);
    }
    consecutiveErrors++;
    return;
  }

  // Respect backoff
  if (currentBackoffMs > 0) {
    const wait = Math.round(currentBackoffMs / 1000);
    console.log(`[${new Date().toISOString()}] Backoff active (${wait}s remaining), skipping poll...`);
    return;
  }

  try {
    const result = await fetchUsageViaOAuth(token);
    const pct = result.primary?.percentUsed ?? 0;
    lastKnownPct = pct;

    await updateLight(config, pct);

    const details = result.limits
      .slice()
      .sort((a, b) => b.percentUsed - a.percentUsed)
      .map((l) => {
        const reset = l.resetAt ? ` resets ${l.resetAt}` : "";
        return `${l.rawType}: ${Math.round(l.percentUsed * 100)}%${reset}`;
      })
      .join(" | ");

    console.log(
      `[${new Date().toISOString()}] ${Math.round(pct * 100)}% (primary: ${result.primary?.rawType ?? "none"}) — ${details}`
    );

    consecutiveErrors = 0;
    currentBackoffMs = 0;
  } catch (err) {
    consecutiveErrors++;
    if (err instanceof OAuthUsageError && err.status === 429) {
      // 429: use Retry-After if present, else exponential backoff up to 5 min
      const retryAfter = err.retryAfterMs ?? Math.min(300_000, 60_000 * Math.pow(2, consecutiveErrors - 1));
      currentBackoffMs = Math.min(retryAfter, 300_000);
      console.warn(
        `[${new Date().toISOString()}] 429 rate-limited. Backing off ${Math.round(currentBackoffMs / 1000)}s (attempt ${consecutiveErrors}). Keeping last light state (${lastKnownPct !== null ? Math.round(lastKnownPct * 100) + "%" : "unknown"}).`
      );
      // Set timeout to clear backoff
      setTimeout(() => {
        currentBackoffMs = 0;
      }, currentBackoffMs);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${new Date().toISOString()}] Fetch failed (${consecutiveErrors}): ${msg}. Keeping last light state.`);
    }
  }
}

export async function startDaemon(): Promise<void> {
  if (isDaemonRunning()) {
    console.log(`Daemon is already running (PID ${readPid()}). Use 'claude-hue stop' first.`);
    return;
  }

  const config = loadConfig();
  ensureConfigDir();
  writePid();
  running = true;

  const baseInterval = config.daemon.pollIntervalMs;
  const jitter = () => Math.floor(Math.random() * 60_000) - 30_000; // ±30s jitter to avoid thundering herd

  console.log("claude-hue daemon started");
  console.log(`  PID:       ${process.pid}`);
  console.log(`  Bridge:    ${config.bridge.ip}`);
  console.log(`  Light:     ${config.light.name} (ID ${config.light.id})`);
  console.log(`  Interval:  ${Math.round(baseInterval / 1000)}s + jitter (±30s)`);
  console.log(`  Mode:      OAuth only (claude login) — handles 2026 monthly/harness limits`);
  console.log("");

  // Graceful shutdown
  const shutdown = () => {
    if (!running) return;
    running = false;
    if (pollTimer) clearInterval(pollTimer);
    removePid();
    console.log("\nDaemon stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Immediate poll, then interval
  await pollOnce(config);
  pollTimer = setInterval(() => {
    if (!running) return;
    pollOnce(config);
  }, baseInterval + jitter());

  // Keep alive
  await new Promise<void>(() => {
    // Never resolves, runs until SIGTERM
  });
}
