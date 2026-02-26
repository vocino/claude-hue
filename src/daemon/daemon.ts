import { createServer, type Server } from "http";
import { watch, existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { loadConfig, USAGE_LOG_PATH, PID_PATH, ensureConfigDir } from "../config/config.js";
import { calculateUsage, trimLog } from "./usage.js";
import { interpolateColor, interpolateBrightness } from "../hue/color.js";
import { setLightColor } from "../hue/light.js";
import { fetchUsage } from "../claude/api.js";
import { getClaudeCodeOAuthToken, fetchUsageViaOAuth } from "../claude/oauth.js";
import type { ClaudeHueConfig } from "../types.js";

const EXTENSION_PORT = 7684;
const USAGE_STALE_MS = 5 * 60 * 1000; // 5 minutes

let running = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let watcher: ReturnType<typeof watch> | null = null;
let httpServer: Server | null = null;

// Latest usage from extension, OAuth, or cookie API
let remoteUsage: {
  percentage: number;
  details: string;
  receivedAt: number;
  source: "extension" | "oauth" | "api";
} | null = null;

function writePid(): void {
  writeFileSync(PID_PATH, process.pid.toString());
}

function removePid(): void {
  try {
    if (existsSync(PID_PATH)) {
      unlinkSync(PID_PATH);
    }
  } catch {
    // Ignore errors during cleanup
  }
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

/**
 * Parse usage data pushed by the browser extension.
 * The extension sends the raw response from /api/organizations/{orgId}/usage.
 */
function parseExtensionUsage(data: unknown): { percentage: number; details: string } | null {
  if (!data || typeof data !== "object") return null;

  const entries: Array<{ type: string; pct: number; reset?: string }> = [];
  const obj = data as Record<string, unknown>;

  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const v = val as Record<string, unknown>;
      // API returns utilization (0-100); also support percentUsed, etc.
      const raw =
        (typeof v.utilization === "number" ? v.utilization : null) ??
        (typeof v.percentUsed === "number" ? v.percentUsed : null) ??
        (typeof v.percent_used === "number" ? v.percent_used : null) ??
        (typeof v.percentage === "number" ? v.percentage : null);
      const pct = raw !== null ? (raw > 1 ? raw : raw * 100) : null;
      if (pct !== null) {
        const reset = (v.resetAt ?? v.reset_at ?? v.resets_at ?? v.resetsAt) as string | undefined;
        entries.push({ type: key, pct, reset });
      }
    }
  }

  if (entries.length === 0) return null;

  const highest = Math.max(...entries.map((e) => e.pct));
  const details = entries
    .map((e) => {
      const resetInfo = e.reset ? `, resets ${e.reset}` : "";
      return `${e.type}: ${Math.round(e.pct)}%${resetInfo}`;
    })
    .join(" | ");

  return { percentage: highest / 100, details };
}

/**
 * Start a tiny HTTP server that receives usage data from the browser extension.
 */
function startHttpServer(config: ClaudeHueConfig): void {
  httpServer = createServer((req, res) => {
    // CORS headers for the browser extension
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/usage") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          const parsed = parseExtensionUsage(data);
          if (parsed) {
            remoteUsage = { ...parsed, receivedAt: Date.now(), source: "extension" };
            // Immediately update the light
            updateLight(config);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Could not parse usage data" }));
          }
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    if (req.method === "GET" && req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          running: true,
          extensionConnected: remoteUsage !== null,
          lastUpdate: remoteUsage?.receivedAt ?? null,
        })
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  httpServer.listen(EXTENSION_PORT, "127.0.0.1", () => {
    console.log(`  Extension server: http://127.0.0.1:${EXTENSION_PORT}`);
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`  Port ${EXTENSION_PORT} in use — extension push disabled`);
    } else {
      console.warn("  Extension server error:", err.message);
    }
  });
}

/**
 * Get usage percentage from the best available source:
 * 1. Browser extension or Claude API (remote, if recent)
 * 2. Local prompt counting (fallback)
 */
function getUsagePercentage(config: ClaudeHueConfig): {
  percentage: number;
  source: "extension" | "oauth" | "api" | "local";
  details: string;
} {
  // Use remote data if recent (extension or API)
  if (remoteUsage && Date.now() - remoteUsage.receivedAt < USAGE_STALE_MS) {
    return {
      percentage: remoteUsage.percentage,
      source: remoteUsage.source,
      details: remoteUsage.details,
    };
  }

  // Fallback: local prompt counting
  const { count, percentage } = calculateUsage(
    USAGE_LOG_PATH,
    config.usage.windowMs,
    config.usage.maxPrompts
  );

  return {
    percentage,
    source: "local",
    details: `${count}/${config.usage.maxPrompts} prompts`,
  };
}

async function fetchUsageOnStartup(config: ClaudeHueConfig): Promise<void> {
  const oauthToken = getClaudeCodeOAuthToken();
  if (oauthToken) {
    try {
      const result = await fetchUsageViaOAuth(oauthToken);
      if (result.limits.length > 0) {
        const details = result.limits
          .map(
            (l) =>
              `${l.type}: ${Math.round(l.percentUsed * 100)}%${l.resetAt ? `, resets ${l.resetAt}` : ""}`
          )
          .join(" | ");
        remoteUsage = {
          percentage: result.highestPercent,
          details,
          receivedAt: Date.now(),
          source: "oauth",
        };
        console.log(`  Usage source: oauth (real usage)`);
        return;
      }
    } catch {
      // Fall through
    }
  }

  if (config.claude?.cookie && config.claude?.orgId) {
    try {
      const result = await fetchUsage(config.claude.cookie, config.claude.orgId);
      if (result.limits.length > 0) {
        const details = result.limits
          .map(
            (l) =>
              `${l.type}: ${Math.round(l.percentUsed * 100)}%${l.resetAt ? `, resets ${l.resetAt}` : ""}`
          )
          .join(" | ");
        remoteUsage = {
          percentage: result.highestPercent,
          details,
          receivedAt: Date.now(),
          source: "api",
        };
        console.log(`  Usage source: cookie API (real usage)`);
        return;
      }
    } catch {
      // Fall through
    }
  }

  if (!remoteUsage) {
    console.log(`  Usage source: local (prompt counting) — install extension or run 'claude login' for real usage`);
  }
}

async function updateLight(config: ClaudeHueConfig): Promise<void> {
  const { percentage, source, details } = getUsagePercentage(config);

  const color = interpolateColor(config.colors.start, config.colors.end, percentage);
  const brightness = interpolateBrightness(
    config.brightness.start,
    config.brightness.end,
    percentage
  );

  try {
    await setLightColor(
      config.bridge.ip,
      config.bridge.username,
      config.light.id,
      color,
      brightness,
      config.daemon.transitionMs
    );
    console.log(
      `[${new Date().toISOString()}] [${source}] ${Math.round(percentage * 100)}% — ${details} — color: (${color.x.toFixed(3)}, ${color.y.toFixed(3)}) bri: ${brightness}`
    );
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Failed to update light:`, err);
  }
}

export async function startDaemon(): Promise<void> {
  if (isDaemonRunning()) {
    console.error("Daemon is already running. Use 'claude-hue stop' first.");
    process.exit(1);
  }

  const config = loadConfig();
  ensureConfigDir();
  writePid();
  running = true;

  console.log("claude-hue daemon started");
  console.log(`  Bridge: ${config.bridge.ip}`);
  console.log(`  Light: ${config.light.name} (ID: ${config.light.id})`);
  console.log(`  Polling every ${config.daemon.pollIntervalMs / 1000}s`);

  // Start HTTP server for browser extension
  startHttpServer(config);

  // Fetch usage immediately (don't wait for first poll)
  await fetchUsageOnStartup(config);

  // Initial update
  await updateLight(config);

  // Watch the usage log for changes
  if (existsSync(USAGE_LOG_PATH)) {
    try {
      watcher = watch(USAGE_LOG_PATH, () => {
        if (running) updateLight(config);
      });
    } catch {
      console.warn("Could not watch usage log; relying on polling only.");
    }
  }

  // Periodic poll: try OAuth (Claude Code) or cookie API when stale, then update light
  pollTimer = setInterval(async () => {
    if (!running) return;
    const isStale =
      !remoteUsage || Date.now() - remoteUsage.receivedAt > USAGE_STALE_MS;

    if (isStale) {
      // 1. Try Claude Code OAuth first (zero config when user has run "claude login")
      const oauthToken = getClaudeCodeOAuthToken();
      if (oauthToken) {
        try {
          const result = await fetchUsageViaOAuth(oauthToken);
          if (result.limits.length > 0) {
            const details = result.limits
              .map(
                (l) =>
                  `${l.type}: ${Math.round(l.percentUsed * 100)}%${l.resetAt ? `, resets ${l.resetAt}` : ""}`
              )
              .join(" | ");
            remoteUsage = {
              percentage: result.highestPercent,
              details,
              receivedAt: Date.now(),
              source: "oauth",
            };
          }
        } catch {
          // Token expired or network error; fall through to cookie or local
        }
      }

      // 2. Fallback: cookie API (if OAuth didn't work and cookie is configured)
      if (
        !remoteUsage &&
        config.claude?.cookie &&
        config.claude?.orgId
      ) {
        try {
          const result = await fetchUsage(config.claude.cookie, config.claude.orgId);
          if (result.limits.length > 0) {
            const details = result.limits
              .map(
                (l) =>
                  `${l.type}: ${Math.round(l.percentUsed * 100)}%${l.resetAt ? `, resets ${l.resetAt}` : ""}`
              )
              .join(" | ");
            remoteUsage = {
              percentage: result.highestPercent,
              details,
              receivedAt: Date.now(),
              source: "api",
            };
          }
        } catch {
          // Cookie API may be blocked by Cloudflare
        }
      }
    }

    await updateLight(config);
    trimLog(USAGE_LOG_PATH, config.usage.windowMs);

    if (!watcher && existsSync(USAGE_LOG_PATH)) {
      try {
        watcher = watch(USAGE_LOG_PATH, () => {
          if (running) updateLight(config);
        });
      } catch {
        // Will retry on next poll
      }
    }
  }, config.daemon.pollIntervalMs);

  // Graceful shutdown
  const shutdown = () => {
    if (!running) return;
    running = false;
    console.log("\nclaude-hue daemon stopping...");
    if (pollTimer) clearInterval(pollTimer);
    if (watcher) watcher.close();
    if (httpServer) httpServer.close();
    removePid();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export function stopDaemon(): void {
  const pid = readPid();
  if (pid === null) {
    console.log("No daemon is running.");
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Daemon (PID ${pid}) stopped.`);
    removePid();
  } catch {
    console.log("Daemon process not found. Cleaning up stale PID file.");
    removePid();
  }
}
