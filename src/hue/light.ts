import type { CieXY } from "../types.js";
import { hueFetch } from "./fetch.js";

/**
 * Set a light's color and brightness via the Hue bridge API.
 * brightness: 0-100 (mapped to 1-254 for the Hue API)
 * transitionMs: transition time in milliseconds (Hue uses 100ms increments)
 */
export async function setLightColor(
  bridgeIp: string,
  username: string,
  lightId: number,
  xy: CieXY,
  brightness: number,
  transitionMs: number
): Promise<void> {
  const bri = Math.max(1, Math.min(254, Math.round((brightness / 100) * 254)));
  const transitiontime = Math.round(transitionMs / 100);

  const res = await hueFetch(
    `https://${bridgeIp}/api/${username}/lights/${lightId}/state`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true, xy: [xy.x, xy.y], bri, transitiontime }),
    }
  );

  if (!res.ok) {
    throw new Error(`setLightColor failed: HTTP ${res.status} ${res.statusText}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("Hue bridge returned invalid JSON for setLightColor");
  }

  if (Array.isArray(data)) {
    const errors = data.filter(
      (r: Record<string, unknown>) => r.error !== undefined
    );
    if (errors.length > 0) {
      throw new Error(`Hue API error: ${JSON.stringify(errors[0])}`);
    }
  }
}

/**
 * Briefly flash a light to help identify it during setup.
 */
export async function flashLight(
  bridgeIp: string,
  username: string,
  lightId: number
): Promise<void> {
  const res = await hueFetch(
    `https://${bridgeIp}/api/${username}/lights/${lightId}/state`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert: "select" }),
    }
  );

  if (!res.ok) {
    throw new Error(`flashLight failed: HTTP ${res.status} ${res.statusText}`);
  }
}
