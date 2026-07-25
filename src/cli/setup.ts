import { select, input } from "@inquirer/prompts";
import { discoverBridges, createUser, getLights } from "../hue/bridge.js";
import { flashLight } from "../hue/light.js";
import { saveConfig, ensureConfigDir } from "../config/config.js";
import { COLOR_PRESETS, hexToCieXY } from "../hue/color.js";
import { DEFAULT_COLORS, DEFAULT_BRIGHTNESS, DEFAULT_DAEMON } from "../config/defaults.js";
import type { ClaudeHueConfig, CieXY } from "../types.js";
import { hasClaudeCodeOAuth } from "../claude/oauth.js";

export async function runSetup(): Promise<void> {
  console.log("\nclaude-hue setup — v2 OAuth-only\n");

  // Step 1: Discover bridge
  console.log("Searching for Hue bridges on your network (discovery.meethue.com)...");
  let bridgeIp: string;
  try {
    const bridges = await discoverBridges();
    if (bridges.length === 0) {
      bridgeIp = await input({
        message: "No bridges found automatically. Enter your bridge IP address:",
      });
    } else if (bridges.length === 1) {
      console.log(`Found bridge at ${bridges[0].internalipaddress}`);
      bridgeIp = bridges[0].internalipaddress;
    } else {
      bridgeIp = await select({
        message: "Multiple bridges found. Select one:",
        choices: bridges.map((b) => ({
          name: `${b.internalipaddress} (${b.id})`,
          value: b.internalipaddress,
        })),
      });
    }
  } catch {
    bridgeIp = await input({
      message: "Bridge discovery failed. Enter your bridge IP address:",
    });
  }

  // Step 2: Pair
  console.log("\nPress the link button on your Hue bridge, then press Enter.");
  await input({ message: "Press Enter when ready (button pressed)..." });

  let username: string;
  let attempts = 0;
  while (true) {
    try {
      const result = await createUser(bridgeIp);
      username = result.username;
      console.log("Paired successfully.");
      break;
    } catch (err) {
      attempts++;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempts >= 3) {
        console.error(`Failed after 3 attempts (${msg}). Make sure you pressed the link button, same LAN.`);
        process.exit(1);
      }
      console.log(`Pair failed: ${msg} — try again...`);
      await input({ message: "Press Enter after pressing the link button..." });
    }
  }

  // Step 3: Light
  console.log("\nFetching lights...");
  const lights = await getLights(bridgeIp, username);
  if (lights.length === 0) {
    console.error("No lights found on this bridge.");
    process.exit(1);
  }

  const lightId = await select({
    message: "Select the light to use:",
    choices: lights.map((l) => ({
      name: `${l.name} (${l.type}${l.state.reachable ? "" : ", unreachable"})`,
      value: parseInt(l.id, 10),
    })),
  });

  const selectedLight = lights.find((l) => parseInt(l.id, 10) === lightId)!;
  console.log(`Flashing "${selectedLight.name}" to confirm...`);
  await flashLight(bridgeIp, username, lightId);

  // Step 4: Colors
  const colorPreset = await select({
    message: "Choose color gradient:",
    choices: [
      { name: "Green → Red (traffic light, default)", value: "green-red" },
      { name: "Green → Orange", value: "green-orange" },
      { name: "Blue → Red", value: "blue-red" },
      { name: "Blue → Purple", value: "blue-purple" },
      { name: "Custom (enter hex codes)", value: "custom" },
    ],
  });

  let startColor: CieXY;
  let endColor: CieXY;

  if (colorPreset === "custom") {
    console.log("\nEnter hex colors (e.g. #40a02b or #d20f39)");
    const startHex = await input({
      message: "Start color (low usage):",
      default: "#40a02b",
      validate: (v) => (hexToCieXY(v.trim()) ? true : "Invalid hex (use e.g. #40a02b)"),
    });
    const endHex = await input({
      message: "End color (high usage):",
      default: "#d20f39",
      validate: (v) => (hexToCieXY(v.trim()) ? true : "Invalid hex (use e.g. #d20f39)"),
    });
    startColor = hexToCieXY(startHex.trim())!;
    endColor = hexToCieXY(endHex.trim())!;
  } else {
    switch (colorPreset) {
      case "green-orange":
        startColor = COLOR_PRESETS.green;
        endColor = COLOR_PRESETS.orange;
        break;
      case "blue-red":
        startColor = COLOR_PRESETS.blue;
        endColor = COLOR_PRESETS.red;
        break;
      case "blue-purple":
        startColor = COLOR_PRESETS.blue;
        endColor = COLOR_PRESETS.purple;
        break;
      default:
        startColor = COLOR_PRESETS.green;
        endColor = COLOR_PRESETS.red;
    }
  }

  // Save — no more maxPrompts/windowMs questions
  const config: ClaudeHueConfig = {
    bridge: { ip: bridgeIp, username },
    light: { id: lightId, name: selectedLight.name },
    colors: { start: startColor, end: endColor },
    brightness: DEFAULT_BRIGHTNESS,
    daemon: DEFAULT_DAEMON,
  };

  ensureConfigDir();
  saveConfig(config);
  console.log("\nConfiguration saved to ~/.claude-hue/config.json");

  if (hasClaudeCodeOAuth()) {
    console.log("\n✓ Claude Code is logged in (found ~/.claude/.credentials.json). Real usage will be used.");
  } else {
    console.log('\nNo Claude Code OAuth token found. Run "claude login" (Claude Code CLI) first, then "claude-hue start".');
  }

  console.log("\nSetup complete. Run 'claude-hue start' to begin — light shows 5h session %, status shows all limits (5h, weekly, monthly, harness).\n");
}
