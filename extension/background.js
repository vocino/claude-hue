// Claude Hue — background service worker
// Periodically fetches usage from claude.ai and pushes it to the local daemon.

const DAEMON_URL = "http://localhost:7684/usage";
const POLL_INTERVAL_MINUTES = 1;
const ALARM_NAME = "claude-hue-poll";

// Fetch usage data from claude.ai using the browser's cookies
async function fetchUsage() {
  try {
    // First, get the org ID
    const orgRes = await fetch("https://claude.ai/api/organizations", {
      credentials: "include",
    });
    if (!orgRes.ok) {
      console.warn("[claude-hue] Failed to fetch orgs:", orgRes.status);
      return null;
    }
    const orgs = await orgRes.json();
    if (!Array.isArray(orgs) || orgs.length === 0) {
      console.warn("[claude-hue] No organizations found");
      return null;
    }
    const orgId = orgs[0].uuid;

    // Now fetch usage
    const usageRes = await fetch(
      `https://claude.ai/api/organizations/${orgId}/usage`,
      { credentials: "include" }
    );
    if (!usageRes.ok) {
      console.warn("[claude-hue] Failed to fetch usage:", usageRes.status);
      return null;
    }
    return await usageRes.json();
  } catch (err) {
    console.warn("[claude-hue] Error fetching usage:", err);
    return null;
  }
}

// Send usage data to the local daemon
async function pushToDaemon(usageData) {
  try {
    const res = await fetch(DAEMON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(usageData),
    });
    if (!res.ok) {
      console.warn("[claude-hue] Daemon rejected data:", res.status);
    }
  } catch {
    // Daemon not running — that's fine, fail silently
  }
}

// Main poll function
async function poll() {
  const usage = await fetchUsage();
  if (usage) {
    await pushToDaemon(usage);
    // Store latest for popup display
    chrome.storage.local.set({ lastUsage: usage, lastPoll: Date.now() });
  }
}

// Set up periodic polling via alarms
chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    poll();
  }
});

// Also poll immediately on install/startup
chrome.runtime.onInstalled.addListener(() => poll());
chrome.runtime.onStartup.addListener(() => poll());

// Listen for manual poll requests from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "poll") {
    poll().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
});
