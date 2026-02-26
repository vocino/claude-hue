import { hueFetch } from "./fetch.js";

export interface DiscoveredBridge {
  id: string;
  internalipaddress: string;
}

/**
 * Discover Hue bridges on the local network via Philips cloud discovery endpoint.
 */
export async function discoverBridges(): Promise<DiscoveredBridge[]> {
  const res = await fetch("https://discovery.meethue.com");
  if (!res.ok) {
    throw new Error(`Bridge discovery failed: ${res.status}`);
  }
  return res.json() as Promise<DiscoveredBridge[]>;
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
  const data = (await res.json()) as Array<
    { success?: { username: string }; error?: { description: string } }
  >;
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
  const data = (await res.json()) as Record<
    string,
    { name: string; type: string; state: { on: boolean; reachable: boolean } }
  >;
  return Object.entries(data).map(([id, light]) => ({
    id,
    name: light.name,
    type: light.type,
    state: light.state,
  }));
}
