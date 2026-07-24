import { Agent } from "undici";

const HUE_FETCH_TIMEOUT_MS = 8_000;

/**
 * Fetch wrapper for Hue bridge API calls.
 * Hue bridges use self-signed TLS certs, so we disable certificate
 * verification for these local-network-only requests (no env var = no warning).
 * Includes a default timeout to avoid hanging on unreachable bridges.
 */
const hueAgent = new Agent({
  connect: { rejectUnauthorized: false },
});

export async function hueFetch(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? HUE_FETCH_TIMEOUT_MS;
  const { timeoutMs: _, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...rest,
      signal: rest.signal ?? controller.signal,
      // @ts-expect-error dispatcher is valid in Node/undici
      dispatcher: hueAgent,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Hue bridge request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
