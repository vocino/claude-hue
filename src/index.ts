#!/usr/bin/env node

import { Command } from "commander";
import { runSetup } from "./cli/setup.js";
import { startDaemon, stopDaemon, isDaemonRunning, readPid } from "./daemon/daemon.js";
import { loadConfig, configExists } from "./config/config.js";
import { hasClaudeCodeOAuth, getClaudeCodeOAuthToken, fetchUsageViaOAuth } from "./claude/oauth.js";
import { interpolateColor, interpolateBrightness } from "./hue/color.js";
import { setLightColor } from "./hue/light.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("claude-hue")
  .description("Visualize Claude Code usage on Philips Hue — green→red as you approach limits. OAuth-only, handles 2026 Max monthly/harness limits.")
  .version(pkg.version);

program
  .command("setup")
  .description("Interactive setup: pair bridge, select light, configure colors (3 questions)")
  .action(async () => {
    await runSetup();
  });

program
  .command("start")
  .description("Start daemon — polls OAuth usage every 5m, updates light")
  .action(async () => {
    if (!configExists()) {
      console.error('No configuration found. Run "claude-hue setup" first.');
      process.exit(1);
    }
    if (!hasClaudeCodeOAuth()) {
      console.warn('Warning: No OAuth token found. Run "claude login" in Claude Code CLI first. Daemon will keep retrying.');
    }
    await startDaemon();
  });

program
  .command("stop")
  .description("Stop running daemon")
  .action(() => {
    stopDaemon();
  });

program
  .command("status")
  .description("Show bridge, light, OAuth status, and all usage limits (5h, weekly, monthly, harness)")
  .action(async () => {
    if (!configExists()) {
      console.error('No configuration found. Run "claude-hue setup" first.');
      process.exit(1);
    }
    const config = loadConfig();
    const running = isDaemonRunning();
    const pid = readPid();
    const hasOAuth = hasClaudeCodeOAuth();

    console.log("claude-hue status\n");
    console.log(`  Daemon:  ${running ? `running (PID ${pid})` : "stopped"}`);
    console.log(`  Bridge:  ${config.bridge.ip}`);
    console.log(`  Light:   ${config.light.name} (ID: ${config.light.id})`);
    console.log(`  Poll:    ${Math.round(config.daemon.pollIntervalMs / 1000)}s interval (OAuth-only, 429-safe)\n`);

    if (!hasOAuth) {
      console.log("  Auth:    NOT FOUND");
      console.log('  Fix:     Run "claude login" in Claude Code CLI (~/.claude/.credentials.json)');
      return;
    }

    console.log("  Auth:    OAuth ✓ (claude login)");
    console.log("");

    try {
      const token = getClaudeCodeOAuthToken()!;
      const result = await fetchUsageViaOAuth(token);

      if (result.limits.length === 0) {
        console.log("  No limits returned from API (unexpected shape).");
        return;
      }

      console.log("  Limits from api.anthropic.com/api/oauth/usage:");
      const sorted = [...result.limits].sort((a, b) => b.percentUsed - a.percentUsed);
      for (const l of sorted) {
        const pct = Math.round(l.percentUsed * 100);
        const reset = l.resetAt ? ` (resets ${l.resetAt})` : "";
        const isPrimary = result.primary && result.primary.rawType === l.rawType ? " ← light" : "";
        console.log(`    ${l.rawType}: ${pct}%${reset}${isPrimary}`);
      }
      console.log("");
      if (result.primary) {
        console.log(`  Primary (light): ${result.primary.rawType} ${Math.round(result.primary.percentUsed * 100)}%`);
        console.log("  (Light shows 5h session % — most dynamic. Weekly/monthly in list above.)");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  API error: ${msg}`);
      if (msg.includes("401")) {
        console.log('  Fix: Run "claude login" to refresh token.');
      } else if (msg.includes("429")) {
        console.log("  Note: Anthropic rate-limiting OAuth usage endpoint. Daemon backs off automatically. See https://github.com/anthropics/claude-code/issues/31021");
      }
    }
  });

program
  .command("demo")
  .description("Cycle light green→yellow→red to verify it works (Ctrl+C to stop)")
  .action(async () => {
    if (!configExists()) {
      console.error('No configuration found. Run "claude-hue setup" first.');
      process.exit(1);
    }
    const config = loadConfig();
    console.log(`Demo on "${config.light.name}" — Ctrl+C to stop.\n`);

    let t = 0;
    let increasing = true;

    const interval = setInterval(async () => {
      const color = interpolateColor(config.colors.start, config.colors.end, t);
      const brightness = interpolateBrightness(config.brightness.start, config.brightness.end, t);
      try {
        await setLightColor(
          config.bridge.ip,
          config.bridge.username,
          config.light.id,
          color,
          brightness,
          config.daemon.transitionMs
        );
        console.log(`  ${Math.round(t * 100)}% — xy(${color.x.toFixed(4)}, ${color.y.toFixed(4)}) bri ${brightness}%`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  Light update failed: ${msg}`);
      }

      if (increasing) {
        t += 0.1;
        if (t >= 1) {
          t = 1;
          increasing = false;
        }
      } else {
        t -= 0.1;
        if (t <= 0) {
          t = 0;
          increasing = true;
        }
      }
    }, 2000);

    process.on("SIGINT", () => {
      clearInterval(interval);
      console.log("\nDemo stopped.");
      process.exit(0);
    });
  });

program.parse(process.argv);
