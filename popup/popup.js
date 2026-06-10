// BunnyCheck — popup.js
// Fetches brand data from the background service worker and populates the
// popup UI with counts and data version.

"use strict";

const STORAGE_KEY = "bunnycheck_brands";

/**
 * Returns the most recent data_version string across all brand entries.
 * @param {object} brands
 * @returns {string}
 */
function getLatestDataVersion(brands) {
  let latest = "";
  for (const entry of Object.values(brands)) {
    if (entry.data_version && entry.data_version > latest) {
      latest = entry.data_version;
    }
  }
  return latest || "unknown";
}

/**
 * Populates the popup with stats derived from the brands object.
 * @param {object} brands
 */
function renderStats(brands) {
  const entries = Object.values(brands);
  const brandCount = entries.length;
  const petaCount  = entries.filter((e) => e.peta).length;
  const lbCount    = entries.filter((e) => e.leaping_bunny).length;
  const version    = getLatestDataVersion(brands);

  document.getElementById("brand-count").textContent  = brandCount;
  document.getElementById("peta-count").textContent   = petaCount;
  document.getElementById("lb-count").textContent     = lbCount;
  document.getElementById("data-version").textContent = version;

  document.getElementById("loading-msg").style.display   = "none";
  document.getElementById("stats-content").style.display = "block";
}

/**
 * Shows an error message in the stats card.
 * @param {string} msg
 */
function renderError(msg) {
  const el = document.getElementById("loading-msg");
  el.textContent = msg;
  el.style.color = "#c62828";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // First try reading directly from storage (faster than a round-trip message).
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    const brands = result[STORAGE_KEY];

    if (brands && Object.keys(brands).length > 0) {
      renderStats(brands);
      return;
    }

    // Fall back to asking the background worker (triggers bundled data load).
    chrome.runtime.sendMessage({ type: "GET_BRANDS" }, (response) => {
      if (chrome.runtime.lastError) {
        renderError("Could not load brand data.");
        return;
      }
      const b = response?.brands ?? {};
      if (Object.keys(b).length > 0) {
        renderStats(b);
      } else {
        renderError("No brand data available.");
      }
    });
  });
});
