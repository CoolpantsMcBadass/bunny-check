// BunnyCheck — background.js (service worker)
// Manages brand data loading, caching in chrome.storage.local, and
// optional staleness checks against a remote URL.

"use strict";

const STORAGE_KEY = "bunnycheck_brands";
// Placeholder: replace with the raw GitHub URL once the repo is live.
const REMOTE_DATA_URL =
  "https://raw.githubusercontent.com/CoolpantsMcBadass/bunny-check/main/data/brands.json";

// Maximum age of cached data before we attempt a remote refresh (7 days).
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Install handler ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  // Always reload from the bundled file on install or update so that
  // a newly shipped brands.json is picked up immediately.
  await loadBundledData();
});

// ─── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_BRANDS") {
    handleGetBrands(sendResponse);
    // Return true to indicate we will call sendResponse asynchronously.
    return true;
  }
});

// ─── Alarm-based staleness check ─────────────────────────────────────────────

// Set an alarm to periodically check whether brand data needs refreshing.
chrome.alarms.create("bunnycheck_refresh", { periodInMinutes: 60 * 24 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "bunnycheck_refresh") {
    await maybeRefreshData();
  }
});

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Responds to a GET_BRANDS message by reading from storage (or bundled data
 * if storage is empty) and calling sendResponse with the brands object.
 * @param {function} sendResponse
 */
async function handleGetBrands(sendResponse) {
  let brands = await loadFromStorage();
  if (!brands) {
    brands = await loadBundledData();
  }
  sendResponse({ brands });
}

/**
 * Reads brand data from chrome.storage.local.
 * Returns the brands object, or null if nothing is stored yet.
 * @returns {Promise<object|null>}
 */
async function loadFromStorage() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? null;
}

/**
 * Fetches the bundled brands.json from the extension package, stores it,
 * and returns the parsed brands object.
 * @returns {Promise<object>}
 */
async function loadBundledData() {
  try {
    const url = chrome.runtime.getURL("data/brands.json");
    const response = await fetch(url);
    const brands = await response.json();
    await chrome.storage.local.set({
      [STORAGE_KEY]: brands,
      bunnycheck_cached_at: Date.now(),
    });
    console.log("[BunnyCheck] Bundled brand data loaded:", Object.keys(brands).length, "brands");
    return brands;
  } catch (err) {
    console.error("[BunnyCheck] Failed to load bundled data:", err);
    return {};
  }
}

/**
 * Checks whether the cached data is older than MAX_CACHE_AGE_MS.
 * If so, attempts to fetch fresh data from REMOTE_DATA_URL and store it.
 * Silently skips the refresh if the network request fails so the extension
 * continues to work offline.
 */
async function maybeRefreshData() {
  const result = await chrome.storage.local.get(["bunnycheck_cached_at", STORAGE_KEY]);
  const cachedAt = result.bunnycheck_cached_at ?? 0;
  const age = Date.now() - cachedAt;

  if (age < MAX_CACHE_AGE_MS) {
    return; // Data is fresh enough.
  }

  // Determine the latest data_version in the current cache.
  const currentBrands = result[STORAGE_KEY] ?? {};
  const currentVersion = getLatestDataVersion(currentBrands);

  try {
    const response = await fetch(REMOTE_DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const freshBrands = await response.json();
    const freshVersion = getLatestDataVersion(freshBrands);

    // Only overwrite if the remote data is actually newer.
    if (freshVersion > currentVersion) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: freshBrands,
        bunnycheck_cached_at: Date.now(),
      });
      console.log("[BunnyCheck] Brand data refreshed from remote. Version:", freshVersion);
    } else {
      // Remote is same version; just update the cache timestamp.
      await chrome.storage.local.set({ bunnycheck_cached_at: Date.now() });
    }
  } catch (err) {
    // Network errors are expected in offline environments — log and move on.
    console.warn("[BunnyCheck] Remote refresh skipped:", err.message);
  }
}

/**
 * Returns the most recent data_version string found across all brand entries.
 * Falls back to "0000-00-00" if none is found.
 * @param {object} brands
 * @returns {string}
 */
function getLatestDataVersion(brands) {
  let latest = "0000-00-00";
  for (const entry of Object.values(brands)) {
    if (entry.data_version && entry.data_version > latest) {
      latest = entry.data_version;
    }
  }
  return latest;
}
