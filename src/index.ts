#!/usr/bin/env node

import { Command } from "commander";
import { runSetup } from "./cli/setup.js";
import { installHook, uninstallHook } from "./cli/install-hook.js";
import { startDaemon, stopDaemon, isDaemonRunning, readPid } from "./daemon/daemon.js";
import { calculateUsage } from "./daemon/usage.js";
import { loadConfig, saveConfig, configExists, USAGE_LOG_PATH, ensureConfigDir } from "./config/config.js";
import { validateCookie, fetchUsage } from "./claude/api.js";
import { hasClaudeCodeOAuth, getClaudeCodeOAuthToken, fetchUsageViaOAuth } from "./claude/oauth.js";
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { input } from "@inquirer/prompts";
import { interpolateColor, interpolateBrightness } from "./hue/color.js";
import { setLightColor } from "./hue/light.js";

const program = new Command();

program
  .name("claude-hue")
  .description("Visualize your Claude usage limits on a Philips Hue light")
  .version("0.1.0");

program
  .command("setup")
  .description("Interactive setup: pair bridge, select light, configure colors and limits")
  .action(async () => {
    await runSetup();
  });

program
  .command("auth")
  .description("Set or update your claude.ai cookie for real usage data")
  .action(async () => {
    if (!configExists()) {
      console.error('No configuration found. Run "claude-hue setup" first.');
      process.exit(1);
    }

    const url = "https://claude.ai/settings/usage";
    console.log("\nOpening claude.ai in your browser...\n");
    openBrowser(url);

    console.log("To get your cookie:");
    console.log("  1. Log in to claude.ai if needed");
    console.log("  2. Press F12 to open DevTools");
    console.log("  3. Go to the Network tab");
    console.log("  4. Reload the page (F5)");
    console.log("  5. Click any request to claude.ai (e.g. 'usage')");
    console.log("  6. In the Headers panel, find 'Cookie:' under Request Headers");
    console.log("  7. Right-click the Cookie value > Copy value");
    console.log("  8. Paste it below");
    console.log("");
    console.log("  Tip: Copy the FULL cookie (starts with anthropic-device-id=...)");
    console.log("  to avoid Cloudflare blocking. The browser extension is easier!\n");

    const raw = await input({
      message: "Paste your Cookie header value:",
    });
    const cookie = raw.trim();

    if (!cookie) {
      console.error("No cookie provided.");
      process.exit(1);
    }

    if (!cookie.includes("sessionKey=") && !cookie.startsWith("sk-ant-sid01-")) {
      console.error(
        "Cookie must contain sessionKey or be a session key (sk-ant-sid01-...). " +
          "Copy the full Cookie header from DevTools for best results."
      );
      process.exit(1);
    }

    console.log("Validating cookie...");
    const result = await validateCookie(cookie);

    if (!result.valid) {
      console.error(`Invalid cookie: ${result.error}`);
      process.exit(1);
    }

    const config = loadConfig();
    config.claude = { cookie, orgId: result.orgId! };
    saveConfig(config);

    console.log("Cookie saved successfully!");
    console.log(`  Organization: ${result.orgId}`);

    // Show current usage as a quick test
    try {
      const usage = await fetchUsage(cookie, result.orgId!);
      if (usage.limits.length > 0) {
        console.log("\nCurrent usage:");
        for (const limit of usage.limits) {
          const pct = Math.round(limit.percentUsed * 100);
          const reset = limit.resetAt ? ` (resets ${limit.resetAt})` : "";
          console.log(`  ${limit.type}: ${pct}%${reset}`);
        }
      }
    } catch {
      console.log("\nUsage check failed, but cookie was saved. The daemon will use it.");
    }

    console.log("\nRestart the daemon to use real usage data: claude-hue stop && claude-hue start");
  });

program
  .command("start")
  .description("Start the daemon to watch usage and update the light")
  .action(async () => {
    if (!configExists()) {
      console.error('No configuration found. Run "claude-hue setup" first.');
      process.exit(1);
    }
    await startDaemon();
  });

program
  .command("stop")
  .description("Stop the running daemon")
  .action(() => {
    stopDaemon();
  });

program
  .command("status")
  .description("Show current usage and daemon status")
  .action(async () => {
    if (!configExists()) {
      console.error('No configuration found. Run "claude-hue setup" first.');
      process.exit(1);
    }
    const config = loadConfig();
    const running = isDaemonRunning();
    const pid = readPid();
    const hasOAuth = hasClaudeCodeOAuth();
    const hasCookie = !!(config.claude?.cookie && config.claude?.orgId);

    let mode = "Local prompt counting";
    if (hasOAuth) mode = "Claude Code OAuth (real usage)";
    else if (hasCookie) mode = "Cookie API (real usage)";

    console.log("claude-hue status\n");
    console.log(`  Daemon:  ${running ? `running (PID ${pid})` : "stopped"}`);
    console.log(`  Bridge:  ${config.bridge.ip}`);
    console.log(`  Light:   ${config.light.name} (ID: ${config.light.id})`);
    console.log(`  Mode:    ${mode}`);

    let showedUsage = false;

    if (hasOAuth) {
      try {
        const token = getClaudeCodeOAuthToken();
        if (token) {
          const usage = await fetchUsageViaOAuth(token);
          for (const limit of usage.limits) {
            const pct = Math.round(limit.percentUsed * 100);
            const reset = limit.resetAt ? ` (resets ${limit.resetAt})` : "";
            console.log(`  ${limit.type}: ${pct}%${reset}`);
          }
          console.log(`  Highest: ${Math.round(usage.highestPercent * 100)}%`);
          showedUsage = true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  OAuth error: ${msg}`);
      }
    }

    if (!showedUsage && hasCookie) {
      try {
        const usage = await fetchUsage(config.claude!.cookie, config.claude!.orgId);
        for (const limit of usage.limits) {
          const pct = Math.round(limit.percentUsed * 100);
          const reset = limit.resetAt ? ` (resets ${limit.resetAt})` : "";
          console.log(`  ${limit.type}: ${pct}%${reset}`);
        }
        console.log(`  Highest: ${Math.round(usage.highestPercent * 100)}%`);
        showedUsage = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  API error: ${msg}`);
      }
    }

    if (!showedUsage) {
      const { count, percentage } = calculateUsage(
        USAGE_LOG_PATH,
        config.usage.windowMs,
        config.usage.maxPrompts
      );
      console.log(`  Usage:   ${count} / ${config.usage.maxPrompts} prompts (${Math.round(percentage * 100)}%)`);
      console.log(`  Window:  ${config.usage.windowMs / 3600000}h`);
      console.log(`\n  For real usage: run 'claude login' (OAuth) or install the browser extension`);
    }
  });

program
  .command("reset")
  .description("Clear the usage log")
  .action(() => {
    ensureConfigDir();
    writeFileSync(USAGE_LOG_PATH, "");
    console.log("Usage log cleared.");
  });

program
  .command("demo")
  .description("Cycle the light through colors to verify it's working (0% → 50% → 100%)")
  .action(async () => {
    if (!configExists()) {
      console.error('No configuration found. Run "claude-hue setup" first.');
      process.exit(1);
    }
    const config = loadConfig();
    const levels = [0, 0.5, 1] as const;
    const labels = ["0% (green)", "50% (yellow)", "100% (red)"];
    console.log("\nDemo: cycling light through usage levels. Press Ctrl+C to stop.\n");
    for (let i = 0; ; i = (i + 1) % 3) {
      const pct = levels[i];
      const color = interpolateColor(config.colors.start, config.colors.end, pct);
      const brightness = interpolateBrightness(
        config.brightness.start,
        config.brightness.end,
        pct
      );
      try {
        await setLightColor(
          config.bridge.ip,
          config.bridge.username,
          config.light.id,
          color,
          brightness,
          2000
        );
        console.log(`  ${labels[i]} — light updated`);
      } catch (err) {
        console.error("Failed to update light:", err);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  });

const hookCmd = program
  .command("hook")
  .description("Manage the Claude Code hook");

hookCmd
  .command("install")
  .description("Install the Claude Code UserPromptSubmit hook")
  .action(() => {
    installHook();
  });

hookCmd
  .command("uninstall")
  .description("Remove the Claude Code hook")
  .action(() => {
    uninstallHook();
  });

program.parse();

function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  try {
    execSync(cmd, { stdio: "ignore" });
  } catch {
    // Ignore errors — the user can open the URL manually
  }
}
