import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const CLAUDE_SETTINGS_DIR = join(homedir(), ".claude");
const CLAUDE_SETTINGS_PATH = join(CLAUDE_SETTINGS_DIR, "settings.json");

function getHookCommand(): string {
  // Resolve the path to the compiled hook script
  const hookScript = resolve(
    import.meta.dirname,
    "..",
    "hook",
    "log-prompt.js"
  );
  // Use forward slashes for cross-platform compatibility (Claude Code uses bash on all platforms)
  return `node "${hookScript.replace(/\\/g, "/")}"`;
}

interface ClaudeSettings {
  hooks?: {
    UserPromptSubmit?: Array<{
      hooks: Array<{
        type: string;
        command: string;
        timeout?: number;
      }>;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function installHook(): void {
  if (!existsSync(CLAUDE_SETTINGS_DIR)) {
    mkdirSync(CLAUDE_SETTINGS_DIR, { recursive: true });
  }

  let settings: ClaudeSettings = {};
  if (existsSync(CLAUDE_SETTINGS_PATH)) {
    settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hookCommand = getHookCommand();
  const hookEntry = {
    type: "command" as const,
    command: hookCommand,
    timeout: 5,
  };

  // Check if our hook already exists
  const existing = settings.hooks.UserPromptSubmit ?? [];
  const alreadyInstalled = existing.some((entry) =>
    entry.hooks.some((h) => h.command.includes("claude-hue"))
  );

  if (alreadyInstalled) {
    console.log("Claude Code hook is already installed.");
    return;
  }

  existing.push({ hooks: [hookEntry] });
  settings.hooks.UserPromptSubmit = existing;

  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  console.log("Claude Code hook installed successfully.");
  console.log(`  Settings: ${CLAUDE_SETTINGS_PATH}`);
  console.log(`  Command: ${hookCommand}`);
}

export function uninstallHook(): void {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) {
    console.log("No Claude settings file found. Nothing to uninstall.");
    return;
  }

  const settings: ClaudeSettings = JSON.parse(
    readFileSync(CLAUDE_SETTINGS_PATH, "utf-8")
  );

  const existing = settings.hooks?.UserPromptSubmit;
  if (!existing) {
    console.log("No claude-hue hook found. Nothing to uninstall.");
    return;
  }

  settings.hooks!.UserPromptSubmit = existing.filter(
    (entry) => !entry.hooks.some((h) => h.command.includes("claude-hue"))
  );

  if (settings.hooks!.UserPromptSubmit.length === 0) {
    delete settings.hooks!.UserPromptSubmit;
  }
  if (Object.keys(settings.hooks!).length === 0) {
    delete settings.hooks;
  }

  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  console.log("Claude Code hook uninstalled successfully.");
}
