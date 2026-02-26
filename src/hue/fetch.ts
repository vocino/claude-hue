import { Agent } from "undici";

/**
 * Fetch wrapper for Hue bridge API calls.
 * Hue bridges use self-signed TLS certs, so we disable certificate
 * verification for these local-network-only requests (no env var = no warning).
 */
const hueAgent = new Agent({
  connect: { rejectUnauthorized: false },
});

export async function hueFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(url, {
    ...init,
    // @ts-expect-error dispatcher is valid in Node/undici
    dispatcher: hueAgent,
  });
}
