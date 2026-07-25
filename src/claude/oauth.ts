import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ClaudeUsageResponse, UsageLimit } from "../types.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const CREDENTIALS_PATHS = [
  join(CLAUDE_DIR, ".credentials.json"),
  join(homedir(), ".claude.ai", ".credentials.json"),
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

export function getClaudeCodeOAuthToken(): string | null {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken && envToken.startsWith("sk-ant-oat")) return envToken;
  for (const path of CREDENTIALS_PATHS) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8");
        const creds = JSON.parse(raw) as CredentialsFile;
        const token = creds.claudeAiOauth?.accessToken;
        if (token && typeof token === "string") return token;
      } catch {}
    }
  }
  return null;
}
export function hasClaudeCodeOAuth(): boolean {
  return getClaudeCodeOAuthToken() !== null;
}
function normalizePercent(raw: number): number {
  if (raw > 1) return raw / 100;
  return raw;
}
function extractPercent(obj: Record<string, unknown>): number | null {
  const candidates = [obj.utilization, obj.percentUsed, obj.percent_used, obj.percentage, obj.percent, obj.usage];
  for (const c of candidates) {
    if (typeof c === "number" && !isNaN(c)) return c;
  }
  return null;
}
function extractReset(obj: Record<string, unknown>): string | null {
  const keys = ["resets_at", "reset_at", "resetAt", "resetsAt", "expires_at", "expiresAt", "reset_time"];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") return v;
  }
  return null;
}
function parseUsageEntry(val: Record<string, unknown>, typeKey: string): UsageLimit | null {
  const rawPct = extractPercent(val);
  if (rawPct === null) return null;
  const pct = normalizePercent(rawPct);
  if (pct < 0 || pct > 10) return null;
  const resetAt = extractReset(val);
  return {
    type: typeKey.toLowerCase(),
    percentUsed: Math.max(0, Math.min(1, pct)),
    resetAt,
    rawType: typeKey,
  };
}
function pickPrimary(limits: UsageLimit[]): UsageLimit | null {
  if (!limits.length) return null;
  const session = limits.find((l) => /five.?hour|session|claude.?code|5h/i.test(l.type));
  if (session) return session;
  const weekly = limits.find((l) => /seven.?day|weekly|7d/i.test(l.type));
  if (weekly) return weekly;
  const monthly = limits.find((l) => /monthly|credit|allowance|agent.?sdk|non.?interactive/i.test(l.type));
  if (monthly) return monthly;
  const harness = limits.find((l) => /harness|tool/i.test(l.type));
  if (harness) return harness;
  const nonExtra = limits.filter((l) => !/extra|overage/i.test(l.type));
  if (nonExtra.length) return nonExtra.sort((a, b) => b.percentUsed - a.percentUsed)[0];
  return limits.sort((a, b) => b.percentUsed - a.percentUsed)[0];
}
export function parseUsageResponse(raw: unknown): ClaudeUsageResponse {
  const limits: UsageLimit[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown> & { type?: string };
        const typeKey = typeof e.type === "string" ? e.type : "unknown";
        const parsed = parseUsageEntry(e, typeKey);
        if (parsed) limits.push(parsed);
      }
    }
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const source: Record<string, unknown> = (() => {
      if (Array.isArray(obj.limits)) {
        const map: Record<string, unknown> = {};
        for (const entry of obj.limits as Array<Record<string, unknown>>) {
          const t = (entry.type as string) ?? (entry.name as string) ?? "unknown";
          map[t] = entry;
        }
        return map;
      }
      return obj;
    })();
    for (const [key, val] of Object.entries(source)) {
      if (!val || typeof val !== "object" || Array.isArray(val)) continue;
      const v = val as Record<string, unknown>;
      const parsed = parseUsageEntry(v, key);
      if (parsed) limits.push(parsed);
    }
    if (limits.length === 0) {
      const rootParsed = parseUsageEntry(obj as Record<string, unknown>, "primary");
      if (rootParsed) limits.push(rootParsed);
    }
  }
  const primary = pickPrimary(limits);
  return { limits, primary };
}
export class OAuthUsageError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = "OAuthUsageError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
function parseRetryAfter(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (header) {
    const secs = parseInt(header, 10);
    if (!isNaN(secs)) return secs * 1000;
    const date = Date.parse(header);
    if (!isNaN(date)) return Math.max(0, date - Date.now());
  }
  return null;
}
export async function fetchUsageViaOAuth(token: string): Promise<ClaudeUsageResponse> {
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
    const retryAfterMs = parseRetryAfter(res);
    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      throw new OAuthUsageError(
        `Rate limited (429). ${body.slice(0, 200) || "Please try again later."} — daemon will backoff. See https://github.com/anthropics/claude-code/issues/31021`,
        429,
        retryAfterMs
      );
    }
    if (res.status === 401) {
      throw new OAuthUsageError(`OAuth token expired (401). Run 'claude login' to re-authenticate.`, 401, null);
    }
    const text = await res.text().catch(() => "");
    throw new OAuthUsageError(`OAuth usage API failed (${res.status}): ${text.slice(0, 300)}`, res.status, retryAfterMs);
  }
  const raw = await res.json();
  return parseUsageResponse(raw);
}
