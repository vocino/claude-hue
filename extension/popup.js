function pctClass(pct) {
  if (pct >= 80) return "pct-high";
  if (pct >= 50) return "pct-mid";
  return "pct-low";
}

function renderUsage(data) {
  const content = document.getElementById("content");
  if (!data) {
    content.innerHTML = '<div class="muted">No usage data yet. Make sure you\'re logged in to claude.ai.</div>';
    return;
  }

  // The usage response format may vary — handle common shapes
  let html = "";
  if (typeof data === "object" && !Array.isArray(data)) {
    for (const [key, val] of Object.entries(data)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const v = val;
        // API returns utilization (0-100); also percentUsed (0-1), etc.
        const raw = v.utilization ?? v.percentUsed ?? v.percent_used ?? v.percentage;
        const pct = typeof raw === "number" ? (raw > 1 ? raw : raw * 100) : null;
        if (pct !== null) {
          const pctRound = Math.round(pct);
          const cls = pctClass(pctRound);
          const reset = v.resetAt || v.reset_at || v.resets_at || v.resetsAt || "";
          html += `<div class="status-line">
            <span class="label">${key}</span>
            <span class="value ${cls}">${pctRound}%</span>
          </div>`;
          if (reset) {
            html += `<div class="status-line">
              <span class="label">Resets</span>
              <span class="value" style="font-size:11px">${new Date(reset).toLocaleString()}</span>
            </div>`;
          }
        }
      }
    }
  }

  if (!html) {
    // Fallback: just show the raw JSON prettified
    html = `<pre style="font-size:10px;overflow:auto;max-height:200px">${JSON.stringify(data, null, 2)}</pre>`;
  }

  content.innerHTML = html;
}

function renderLastPoll(ts) {
  const el = document.getElementById("lastPoll");
  if (!ts) {
    el.textContent = "";
    return;
  }
  const ago = Math.round((Date.now() - ts) / 1000);
  if (ago < 60) {
    el.textContent = `Last updated: ${ago}s ago`;
  } else {
    el.textContent = `Last updated: ${Math.round(ago / 60)}m ago`;
  }
}

// Load stored data
chrome.storage.local.get(["lastUsage", "lastPoll"], (result) => {
  renderUsage(result.lastUsage || null);
  renderLastPoll(result.lastPoll || null);
});

// Refresh button
document.getElementById("refresh").addEventListener("click", () => {
  document.getElementById("content").innerHTML = '<div class="muted">Refreshing...</div>';
  chrome.runtime.sendMessage({ type: "poll" }, () => {
    setTimeout(() => {
      chrome.storage.local.get(["lastUsage", "lastPoll"], (result) => {
        renderUsage(result.lastUsage || null);
        renderLastPoll(result.lastPoll || null);
      });
    }, 2000);
  });
});
