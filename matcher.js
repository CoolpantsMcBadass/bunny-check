// BunnyCheck — matcher.js
// Provides BrandMatcher: a class that takes a brands object and efficiently
// identifies whether a given text string mentions a known brand.
//
// Matching strategy (in order):
//   1. Exact normalized match on the lookup map (O(1)).
//   2. Linear alias scan with exact match on each alias.
//   3. Simple fuzzy: checks if any alias is a substring of the text, or if
//      the text is a substring of any alias — with length gating to avoid
//      false positives from very short tokens.

"use strict";

class BrandMatcher {
  /**
   * @param {object} brands — The brands object from brands.json.
   *   Keys are brand_key strings; values are brand entry objects.
   */
  constructor(brands) {
    this._brands = brands;

    // Build a flat lookup map: normalized string → brand entry.
    // Each entry's display_name and all its aliases are indexed.
    this._map = new Map();

    for (const entry of Object.values(brands)) {
      // Index display_name.
      this._map.set(normalize(entry.display_name), entry);

      // Index each alias.
      for (const alias of entry.aliases ?? []) {
        this._map.set(normalize(alias), entry);
      }
    }
  }

  /**
   * Exact-only lookup — no fuzzy. Used for prefix matching in content.js
   * to avoid shade names like "Cinnamon" fuzzy-matching "Lian Cinnamon".
   *
   * `allowGeneric`: entries flagged generic_name are brands whose name is a
   * common word (essence, LUSH, Hair+). They exact-match ordinary page text —
   * category tiles, nav links — so they are only returned when the caller
   * vouches that `text` came from a dedicated brand-name element.
   * @param {string} text
   * @param {boolean} [allowGeneric=false]
   * @returns {object|null}
   */
  matchExact(text, allowGeneric = false) {
    if (!text || typeof text !== "string") return null;
    const norm = normalize(text);
    const entry = this._map.get(norm) ?? null;
    if (entry && entry.generic_name && !allowGeneric) return null;
    return entry;
  }

  /**
   * Attempts to find a brand mentioned in `text`.
   * Returns the matching brand entry object, or null if no match.
   * @param {string} text
   * @param {boolean} [allowGeneric=false] — see matchExact.
   * @returns {object|null}
   */
  match(text, allowGeneric = false) {
    if (!text || typeof text !== "string") return null;

    const norm = normalize(text);
    if (!norm) return null;

    // 1. Exact match.
    if (this._map.has(norm)) {
      const entry = this._map.get(norm);
      if (!entry.generic_name || allowGeneric) return entry;
    }

    // 2 & 3. Alias scan: check for exact match, then substring fuzzy.
    for (const [key, entry] of this._map) {
      // Skip short keys to avoid false positives (e.g. "new", "milk" alone).
      if (key.length < 5) continue;

      // Generic-named brands never fuzzy-match arbitrary text.
      if (entry.generic_name && !allowGeneric) continue;

      // Exact match already checked above via Map.has, but this loop
      // is keyed differently so we re-check just in case.
      if (norm === key) return entry;

      // Fuzzy: key is a substring of norm — only fire when the input text is
      // short enough that it's plausibly a brand name field, not a paragraph.
      // Gate: input must be no more than 2x the key length. This stops a brand
      // name buried inside a long banner headline from triggering a match.
      // Also require the match to start at a word boundary so e.g. "nars" can't
      // match inside "sunars" or similar accidental substrings.
      if (norm.includes(key) && norm.length <= key.length * 2) {
        const idx = norm.indexOf(key);
        if (idx === 0 || /[\s-]/.test(norm[idx - 1])) return entry;
      }

      // Fuzzy: norm is a substring of key — only useful if the text is a
      // near-complete alias (length ratio gate: text must be >= 60% of key).
      // Also require norm itself to be at least 5 chars so common short words
      // like "new", "air", "gel" don't fuzzy-match brand names like "Newma".
      // Require word-boundary alignment so "it cosmetics" can't match inside
      // "benefit cosmetics".
      if (norm.length >= 5 && key.includes(norm) && norm.length >= key.length * 0.6) {
        const idx = key.indexOf(norm);
        if (idx === 0 || /[\s-]/.test(key[idx - 1])) return entry;
      }
    }

    return null;
  }
}

/**
 * Normalizes a string for comparison: lowercases, strips punctuation
 * (except internal hyphens and spaces), and collapses whitespace.
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/['']/g, "")          // remove smart/straight apostrophes
    .replace(/[^\w\s-]/g, " ")     // replace non-word chars (except hyphen) with space
    .replace(/\s+/g, " ")          // collapse whitespace
    .trim();
}

// Make BrandMatcher available in both module and content-script contexts.
// content.js imports this via manifest content_scripts (not ES modules),
// so we attach to window rather than using export.
if (typeof window !== "undefined") {
  window.BrandMatcher = BrandMatcher;
  window._bunnyNormalize = normalize;
}
