#!/usr/bin/env node

/**
 * Claude Code hook script (UserPromptSubmit).
 * Appends the current timestamp to the usage log.
 * Designed to be as fast and minimal as possible.
 */

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const configDir = join(homedir(), ".claude-hue");
const logPath = join(configDir, "usage.log");

if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

appendFileSync(logPath, new Date().toISOString() + "\n");
