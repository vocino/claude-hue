import { hueFetch } from "./fetch.js";

export interface DiscoveredBridge {
  id: string;
  internalipaddress: string;
}

/**
 * Discover Hue bridges on the local network via Philips cloud discovery endpoint.
 */
export async function discoverBridges(): Promise<DiscoveredBridge[]> {
  try {
    const res = await fetch("https://discovery.meethue.com", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Bridge discovery failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("Bridge discovery returned unexpected response shape");
    }
    return data as DiscoveredBridge[];
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("Bridge discovery timed out — check your internet connection");
    }
    throw err;
  }
}

/**
 * Create a new user/application key on the bridge.
 * The link button must be pressed before calling this.
 */
export async function createUser(
  bridgeIp: string
): Promise<{ username: string }> {
  const res = await hueFetch(`https://${bridgeIp}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      devicetype: "claude-hue#user",
      generateclientkey: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Bridge request failed: HTTP ${res.status} ${res.statusText}`);
  }

  let data: Array<
    { success?: { username: string }; error?: { description: string } }
  >;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error("Bridge returned invalid JSON response");
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Unexpected response from bridge (empty or non-array)");
  }

  if (data[0]?.error) {
    throw new Error(data[0].error.description);
  }
  if (!data[0]?.success?.username) {
    throw new Error("Unexpected response from bridge");
  }
  return { username: data[0].success.username };
}

export interface HueLight {
  id: string;
  name: string;
  type: string;
  state: { on: boolean; reachable: boolean };
}

/**
 * Get all lights from the bridge.
 */
export async function getLights(
  bridgeIp: string,
  username: string
): Promise<HueLight[]> {
  const res = await hueFetch(`https://${bridgeIp}/api/${username}/lights`);

  if (!res.ok) {
    throw new Error(`Failed to get lights: HTTP ${res.status} ${res.statusText}`);
  }

  let data: Record<
    string,
    { name: string; type: string; state: { on: boolean; reachable: boolean } }
  >;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error("Bridge returned invalid JSON for lights");
  }

  // Hue returns an error object when auth fails instead of a light map
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const raw = data as unknown as Record<string, unknown>;
    if (raw.error) {
      throw new Error(`Hue API error: ${JSON.stringify(raw.error)}`);
    }
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Unexpected lights response shape from bridge");
  }

  return Object.entries(data).map(([id, light]) => ({
    id,
    name: light.name,
    type: light.type,
    state: light.state,
  }));
}
