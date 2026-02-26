import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parseUsageResponse, type ClaudeUsageResponse } from "./api.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const CLAUDE_AI_DIR = join(homedir(), ".claude.ai");
const CREDENTIALS_PATHS = [
  join(CLAUDE_DIR, ".credentials.json"),
  join(CLAUDE_AI_DIR, ".credentials.json"), // alternate location
];
const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

interface ClaudeAiOAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

interface CredentialsFile {
  claudeAiOauth?: ClaudeAiOAuth;
}

/**
 * Get OAuth access token from Claude Code credentials.
 * Tries: ~/.claude/.credentials.json (Windows/Linux) → CLAUDE_CODE_OAUTH_TOKEN env
 */
export function getClaudeCodeOAuthToken(): string | null {
  // 1. Environment variable (explicit override)
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken && envToken.startsWith("sk-ant-oat")) {
    return envToken;
  }

  // 2. Credentials file (used by Claude Code CLI on Windows/Linux)
  for (const path of CREDENTIALS_PATHS) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8");
        const creds = JSON.parse(raw) as CredentialsFile;
        const token = creds.claudeAiOauth?.accessToken;
        if (token && typeof token === "string") {
          return token;
        }
      } catch {
        // Invalid JSON or missing fields
      }
    }
  }

  return null;
}

/**
 * Check if Claude Code OAuth credentials are available.
 */
export function hasClaudeCodeOAuth(): boolean {
  return getClaudeCodeOAuthToken() !== null;
}

/**
 * Fetch usage from Anthropic's OAuth API (used by Claude Code CLI).
 * Same five_hour, seven_day, seven_day_sonnet format as claude.ai.
 * No cookie, no Cloudflare — uses Bearer token.
 */
export async function fetchUsageViaOAuth(
  token: string
): Promise<ClaudeUsageResponse> {
  const res = await fetch(OAUTH_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        "Claude Code OAuth token expired. Run 'claude login' to re-authenticate."
      );
    }
    const text = await res.text();
    throw new Error(`OAuth usage API failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const raw = await res.json();
  // Same format as claude.ai: five_hour, seven_day, seven_day_sonnet with utilization
  return parseUsageResponse(raw);
}
