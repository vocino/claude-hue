export interface UsageLimit {
  type: string;
  percentUsed: number;
  resetAt: string | null;
}

export interface ClaudeUsageResponse {
  limits: UsageLimit[];
  highestPercent: number;
}

interface OrgResponse {
  uuid: string;
  name: string;
}

// Browser-like headers to avoid Cloudflare bot detection
function makeHeaders(cookie: string): Record<string, string> {
  // Ensure Cookie header: accept full string or just sessionKey=
  const cookieValue = cookie.includes("=") ? cookie : `sessionKey=${cookie}`;
  return {
    Cookie: cookieValue,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Referer: "https://claude.ai/settings/usage",
    Origin: "https://claude.ai",
  };
}

/**
 * Extract the sessionKey from a full cookie string for storage.
 */
export function extractSessionKey(cookieStr: string): string | null {
  const match = cookieStr.match(/sessionKey=(sk-ant-sid01-[^\s;]+)/);
  return match ? match[1] : null;
}

/**
 * Extract org ID from lastActiveOrg cookie if present.
 */
function getOrgIdFromCookie(cookie: string): string | null {
  const match = cookie.match(/lastActiveOrg=([^\s;]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch org ID from /api/bootstrap (returns lastActiveOrgId).
 */
async function fetchOrgIdFromBootstrap(cookie: string): Promise<string | null> {
  const res = await fetch("https://claude.ai/api/bootstrap", {
    headers: makeHeaders(cookie),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const account = json?.account as Record<string, unknown> | undefined;
  return (account?.lastActiveOrgId as string) ?? null;
}

/**
 * Fetch the user's organization ID from claude.ai.
 * Tries: lastActiveOrg cookie → /api/bootstrap → /api/organizations
 */
export async function fetchOrgId(cookie: string): Promise<string> {
  // 1. Check cookie first (fastest)
  const fromCookie = getOrgIdFromCookie(cookie);
  if (fromCookie) return fromCookie;

  // 2. Try bootstrap (some setups prefer this)
  const fromBootstrap = await fetchOrgIdFromBootstrap(cookie);
  if (fromBootstrap) return fromBootstrap;

  // 3. Fallback to organizations list
  const res = await fetch("https://claude.ai/api/organizations", {
    headers: makeHeaders(cookie),
  });

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    if (res.status === 401 || res.status === 403) {
      const isCloudflare = body.includes("Just a moment");
      if (isCloudflare) {
        throw new Error(
          "Blocked by Cloudflare. Copy the FULL Cookie header from DevTools (starts with anthropic-device-id=...), not just sessionKey."
        );
      }
      throw new Error(`Session key rejected (${res.status}).`);
    }
    throw new Error(
      `Failed to fetch organizations: ${res.status}. Response: ${body.slice(0, 200)}`
    );
  }

  const text = await res.text();
  let orgs: OrgResponse[];
  try {
    orgs = JSON.parse(text) as OrgResponse[];
  } catch {
    throw new Error(
      `Unexpected response from /api/organizations: ${text.slice(0, 300)}`
    );
  }
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error(`No organizations found. Response: ${text.slice(0, 300)}`);
  }
  return orgs[0].uuid;
}

/**
 * Fetch real usage data from claude.ai's internal API.
 * Returns usage percentages and reset times for all active limits.
 */
export async function fetchUsage(
  cookie: string,
  orgId: string
): Promise<ClaudeUsageResponse> {
  const res = await fetch(
    `https://claude.ai/api/organizations/${orgId}/usage`,
    {
      method: "GET",
      headers: makeHeaders(cookie),
    }
  );

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Cookie expired or invalid. Run 'claude-hue auth' to update it."
      );
    }
    throw new Error(`Failed to fetch usage: ${res.status}`);
  }

  const raw = await res.json();
  return parseUsageResponse(raw);
}

export function parseUsageResponse(raw: unknown): ClaudeUsageResponse {
  const limits: UsageLimit[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === "object") {
        const limit = parseUsageEntry(entry as Record<string, unknown>);
        if (limit) limits.push(limit);
      }
    }
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const limit = parseUsageEntry(val as Record<string, unknown>, key);
        if (limit) limits.push(limit);
      }
      if (
        key === "percentUsed" ||
        key === "percent_used" ||
        key === "percentage"
      ) {
        const limit = parseUsageEntry(obj);
        if (limit) {
          limits.push(limit);
          break;
        }
      }
    }
  }

  // Use current session (five_hour) for the light — resets every ~5 hours so the light
  // changes more often. Fall back to seven_day if five_hour isn't present.
  const fiveHour = limits.find(
    (l) =>
      l.type.toLowerCase().includes("five_hour") ||
      l.type.toLowerCase().includes("five hour")
  );
  const sevenDay = limits.find(
    (l) =>
      l.type.toLowerCase().includes("seven_day") ||
      l.type.toLowerCase().includes("seven day")
  );
  const primary = fiveHour ?? sevenDay;
  const limitsForHighest = primary ? [primary] : limits.filter((l) => !l.type.toLowerCase().includes("extra"));
  const highestPercent =
    limitsForHighest.length > 0
      ? Math.max(...limitsForHighest.map((l) => l.percentUsed))
      : 0;

  return { limits, highestPercent };
}

function parseUsageEntry(
  entry: Record<string, unknown>,
  fallbackType?: string
): UsageLimit | null {
  // API returns "utilization" (0-100); also support percentUsed, etc.
  const rawPercent =
    toNumber(entry.utilization) ??
    toNumber(entry.percentUsed) ??
    toNumber(entry.percent_used) ??
    toNumber(entry.percentage) ??
    toNumber(entry.usage_percentage);

  if (rawPercent === null) return null;

  // utilization/percentUsed are 0-100; normalize to 0-1
  const percent = rawPercent > 1 ? rawPercent / 100 : rawPercent;

  const type =
    (entry.type as string) ??
    (entry.name as string) ??
    (entry.limit_type as string) ??
    fallbackType ??
    "unknown";

  const resetAt =
    (entry.resetAt as string) ??
    (entry.reset_at as string) ??
    (entry.resets_at as string) ??
    (entry.resetsAt as string) ??
    (entry.expires_at as string) ??
    null;

  return { type, percentUsed: percent, resetAt };
}

function toNumber(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    if (!isNaN(n)) return n;
  }
  return null;
}

/**
 * Validate that a cookie string works by attempting to fetch the org ID.
 */
export async function validateCookie(
  cookie: string
): Promise<{ valid: boolean; orgId?: string; error?: string }> {
  try {
    const orgId = await fetchOrgId(cookie);
    return { valid: true, orgId };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
