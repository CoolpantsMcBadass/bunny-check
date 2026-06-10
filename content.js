// BunnyCheck — content.js
"use strict";

const MAX_ANCESTOR_WALK = 12;
const MIN_BADGE_WIDTH = 80;
const PROCESSED_ATTR = "data-bunnycheck-done";

// ─── SVG badge markup ─────────────────────────────────────────────────────────

function petaBadgeSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="28" role="img" aria-label="PETA Cruelty-Free certified">
  <rect width="72" height="28" rx="6" ry="6" fill="#2e7d32"/>
  <ellipse cx="14" cy="16" rx="5" ry="6" fill="#a5d6a7"/>
  <ellipse cx="12" cy="9" rx="1.5" ry="4" fill="#a5d6a7"/>
  <ellipse cx="16" cy="9" rx="1.5" ry="4" fill="#a5d6a7"/>
  <circle cx="14" cy="15" r="1" fill="#1b5e20"/>
  <text x="23" y="12" font-family="sans-serif" font-size="7" font-weight="bold" fill="#ffffff">PETA</text>
  <text x="23" y="22" font-family="sans-serif" font-size="7" fill="#a5d6a7">Cruelty-Free</text>
</svg>`;
}

function lbBadgeSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="28" role="img" aria-label="Leaping Bunny certified">
  <rect width="72" height="28" rx="6" ry="6" fill="#1565c0"/>
  <ellipse cx="14" cy="17" rx="6" ry="4.5" fill="#90caf9" transform="rotate(-15 14 17)"/>
  <ellipse cx="11" cy="10" rx="1.4" ry="3.5" fill="#90caf9" transform="rotate(10 11 10)"/>
  <ellipse cx="15" cy="9"  rx="1.4" ry="3.5" fill="#90caf9" transform="rotate(-10 15 9)"/>
  <circle cx="14" cy="16" r="1" fill="#0d47a1"/>
  <text x="24" y="12" font-family="sans-serif" font-size="7" font-weight="bold" fill="#ffffff">Leaping</text>
  <text x="24" y="22" font-family="sans-serif" font-size="7" fill="#90caf9">Bunny</text>
</svg>`;
}

function parentWarnBadgeSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="28" role="img" aria-label="Parent company is not cruelty-free">
  <rect width="84" height="28" rx="6" ry="6" fill="#b45309"/>
  <text x="8" y="12" font-family="sans-serif" font-size="9" font-weight="bold" fill="#fef3c7">⚠ But...</text>
  <text x="8" y="23" font-family="sans-serif" font-size="7" fill="#fde68a">parent tests</text>
</svg>`;
}

function dotBadgeSVG(hasPeta, hasLB) {
  const fill = hasPeta && hasLB ? "url(#split)" : hasPeta ? "#2e7d32" : "#1565c0";
  const label = hasPeta && hasLB ? "PETA & Leaping Bunny certified"
    : hasPeta ? "PETA Cruelty-Free certified" : "Leaping Bunny certified";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" role="img" aria-label="${label}">
  <defs><linearGradient id="split" x1="0" x2="1" y1="0" y2="0">
    <stop offset="50%" stop-color="#2e7d32"/><stop offset="50%" stop-color="#1565c0"/>
  </linearGradient></defs>
  <circle cx="6" cy="6" r="5" fill="${fill}" stroke="#fff" stroke-width="1"/>
</svg>`;
}

// ─── Badge injection ──────────────────────────────────────────────────────────

// Live badge overlays: { host, img } pairs, pruned in scanPage when the
// framework removes either node so the image can be re-badged on re-render.
const activeBadges = [];

function injectBadge(imgEl, brandEntry) {
  if (imgEl.hasAttribute(PROCESSED_ATTR)) return;

  const parent = imgEl.parentElement;
  if (!parent) return;
  imgEl.setAttribute(PROCESSED_ATTR, "1");

  const hasPeta = !!brandEntry.peta;
  const hasLB = !!brandEntry.leaping_bunny;
  const renderedWidth = imgEl.offsetWidth || imgEl.naturalWidth || 0;
  const useSmallDot = renderedWidth > 0 && renderedWidth < MIN_BADGE_WIDTH;

  // Overlay WITHOUT reparenting the image. Ulta's frontend is framework-
  // rendered; moving the img into a wrapper makes the framework throw
  // (NotFoundError on removeChild) or duplicate nodes when it re-renders
  // the card. Instead, append an absolutely-positioned host to the image's
  // existing parent, anchored to the image's bottom-left corner.
  if (window.getComputedStyle(parent).position === "static") {
    parent.style.position = "relative";
  }
  const host = document.createElement("span");
  host.setAttribute("data-bunnycheck-badge", "1");
  host.setAttribute("aria-hidden", "false");
  const left = imgEl.offsetLeft + 4;
  const top = imgEl.offsetTop + imgEl.offsetHeight - 4;
  host.style.cssText = `position:absolute;left:${left}px;top:${top}px;transform:translateY(-100%);z-index:2147483647;pointer-events:none;line-height:0;`;
  parent.appendChild(host);
  activeBadges.push({ host, img: imgEl });

  const shadow = host.attachShadow({ mode: "open" });

  const hasParentWarn = !!brandEntry.parent_cf_bad;

  let badgeHTML = "";
  if (useSmallDot) {
    badgeHTML = dotBadgeSVG(hasPeta, hasLB);
  } else {
    const badges = [];
    if (hasPeta) badges.push(petaBadgeSVG());
    if (hasLB) badges.push(lbBadgeSVG());
    if (hasParentWarn) badges.push(parentWarnBadgeSVG());
    badgeHTML = badges.join('<span style="display:inline-block;width:3px;"></span>');
  }

  const certLabels = [];
  if (hasPeta) certLabels.push("PETA Cruelty-Free");
  if (hasLB) certLabels.push("Leaping Bunny");
  if (hasParentWarn) certLabels.push(`parent company (${brandEntry.parent_company || "unknown"}) is not cruelty-free`);

  shadow.innerHTML = `
    <style>
      :host { display:inline-flex;align-items:flex-end;gap:3px; }
      .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
      .badge-wrap { display:inline-flex;align-items:center;gap:3px; }
    </style>
    <span class="sr-only">${brandEntry.display_name}: ${certLabels.join(" and ")} certified</span>
    <span class="badge-wrap">${badgeHTML}</span>
  `;
}

// ─── Ulta-specific brand extraction ──────────────────────────────────────────

// Selectors for Ulta's rendered brand-name elements (grid cards + detail page).
// Ulta uses Polymer web components; class names follow pal-c-* and Text-* patterns.
const ULTA_BRAND_SELECTORS = [
  '[class*="Text-brandName"]',
  '[class*="ProductCard__brandName"]',
  '[class*="ProductCard-brandName"]',
  '[class*="brandName"]',
  '[class*="brand-name"]',
  '[data-testid="brand-name"]',
  '[data-testid="brand"]',
  '[itemprop="brand"]',
  'a[href*="/brand/"]',
];

// Tier-0 walk stops once an ancestor's text exceeds a single product card
// (same 1200-char bound as the tier-2 walk; large enough for shade-heavy cards).
const MAX_BRAND_WALK = 8;
const MAX_CARD_TEXT = 1200;

/**
 * Walks up from imgEl and searches descendants at each level for a
 * Ulta-specific brand element. Returns the brand name string or null.
 * Used as tier-0 — faster and more reliable than full innerText parsing on
 * product cards that have brand elements explicitly in the DOM.
 *
 * The walk is bounded to the product card: once an ancestor's text exceeds
 * MAX_CARD_TEXT we are above the card (grid/page level), where querySelector
 * would return the FIRST brand element on the page — a different product's
 * brand, or a nav link — so we stop instead of cross-matching.
 */
function getUltaBrandFromAncestors(imgEl) {
  let node = imgEl.parentElement;
  for (let i = 0; i < MAX_BRAND_WALK; i++) {
    if (!node || node === document.body) break;
    if ((node.textContent || "").trim().length > MAX_CARD_TEXT) break;
    for (const sel of ULTA_BRAND_SELECTORS) {
      const els = node.querySelectorAll(sel);
      if (els.length === 0) continue;
      // Multiple DISTINCT matches means this ancestor spans more than one
      // product card (or a nav brand-link list) — abort the whole walk.
      // Nested matches (a brandName wrapper around a brandName span) count
      // as one.
      if (els.length > 1) {
        let allNested = true;
        for (let j = 1; j < els.length; j++) {
          if (!els[0].contains(els[j])) { allNested = false; break; }
        }
        if (!allNested) return null;
      }
      const text = (els[0].innerText || els[0].textContent || "").trim();
      if (text.length >= 2 && text.length <= 80) return text;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * On a product detail page (/p/ in the URL), the brand name is in a page-level
 * element not structurally related to the product image gallery. Search the
 * whole document for it.
 */
function getUltaDetailPageBrand() {
  if (!/\/p\//.test(location.pathname)) return null;
  for (const sel of ULTA_BRAND_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      const text = (el.innerText || el.textContent || "").trim();
      if (text.length >= 2 && text.length <= 80) return text;
    }
  }
  return null;
}

// ─── Text gathering ───────────────────────────────────────────────────────────

/**
 * Gathers text candidates for brand matching around a product image.
 *
 * Tier 0 — Ulta-specific brand name element (explicit DOM element, most reliable).
 * Tier 1 — the image's own attributes (alt, title, data-brand, aria-label).
 * Tier 2 — the product card ancestor's first line of rendered text.
 *
 * `hasCardBrand` reports whether tier 0 found a brand element inside the
 * image's own card — used to keep the PDP fallback away from images that
 * belong to their own product card (e.g. recommendation carousels).
 */
function gatherNearbyText(imgEl) {
  const tier1 = [];
  const tier2 = [];

  // Tier 0: Ulta-specific brand element in ancestor subtree.
  const ultaBrand = getUltaBrandFromAncestors(imgEl);
  if (ultaBrand) tier1.unshift(ultaBrand);

  // Tier 1: image's own attributes.
  for (const attr of ["alt", "title", "aria-label", "data-product-name", "data-brand"]) {
    const val = imgEl.getAttribute(attr);
    if (val && val.trim()) tier1.push(val.trim());
  }

  // Tier 2: walk up looking for the product card ancestor.
  let node = imgEl.parentElement;
  for (let i = 0; i < MAX_ANCESTOR_WALK; i++) {
    if (!node || node === document.body) break;

    // <a> with text content: for sites that wrap images in product links.
    if (node.tagName === "A") {
      const label = (node.getAttribute("aria-label") || node.textContent || "").trim();
      if (label.length >= 3 && label.length <= 300) {
        tier2.push(label);
        break;
      }
    }

    // First ancestor with card-level text (not a bare image container).
    // Use innerText so block elements produce newline separators — this ensures
    // "BrandName" and "Product Name" are split even without explicit whitespace.
    const tcLen = (node.textContent || "").trim().length;
    if (tcLen >= 15 && tcLen <= 1200) {
      const inner = (node.innerText || "").trim();
      // If innerText is empty but textContent is not, the element is CSS-hidden
      // (e.g. visibility:hidden during Ulta's card reveal animation). Don't fall
      // back to textContent — block elements have no separators so brand names
      // get concatenated ("essencePure") and prefix matching fails. Instead
      // return nothing and let the retry logic re-process when the card reveals.
      if (!inner) break;
      const firstLine = inner.split(/[\n\r]+/).find(l => l.trim().length >= 3);
      if (firstLine) tier2.push(firstLine.trim().slice(0, 150));
      break;
    }
    if (tcLen > 1200) break;

    node = node.parentElement;
  }

  return { tier1, tier2, hasCardBrand: !!ultaBrand };
}

function getBgImageUrl(el) {
  try {
    const style = window.getComputedStyle(el);
    const bg = style.backgroundImage;
    if (bg && bg !== "none") {
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) return m[1];
    }
  } catch (_) {}
  return null;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/**
 * Tries the full text first, then progressively shorter word-prefixes (up to 4).
 * Prefix matching uses exact-only — no fuzzy — so shade names don't match brands.
 */
function matchWithPrefixes(text) {
  if (!text) return null;
  const direct = window._bunnyMatcher.match(text);
  if (direct) return direct;
  const words = text.trim().split(/\s+/);
  for (let i = Math.min(words.length - 1, 4); i >= 1; i--) {
    const prefix = words.slice(0, i).join(" ");
    const brand = window._bunnyMatcher.matchExact(prefix);
    if (brand) return brand;
  }
  return null;
}

// ─── Badge element ────────────────────────────────────────────────────────────

function tryBadgeElement(el) {
  if (el.hasAttribute(PROCESSED_ATTR)) {
    intersectionObserver.unobserve(el);
    return;
  }

  // Skip hover/secondary images: if a sibling within 3 DOM levels is already
  // badged, this is the same product's alternate view.
  let dedupeNode = el;
  for (let i = 0; i < 3; i++) {
    if (!dedupeNode.parentElement) break;
    dedupeNode = dedupeNode.parentElement;
    if (dedupeNode.querySelector(`img[${PROCESSED_ATTR}="1"]`)) {
      el.setAttribute(PROCESSED_ATTR, "0");
      intersectionObserver.unobserve(el);
      return;
    }
  }

  const { tier1, tier2, hasCardBrand } = gatherNearbyText(el);

  // If no text was found at all, the card body hasn't rendered yet.
  // Drop from observedElements so the next scanPage() (fired by MutationObserver
  // when the card text loads) will re-observe and retry this element.
  if (tier1.length === 0 && tier2.length === 0) {
    intersectionObserver.unobserve(el);
    observedElements.delete(el);
    return;
  }

  intersectionObserver.unobserve(el);

  for (const text of tier1) {
    const brand = matchWithPrefixes(text);
    if (brand) {
      console.log(`[BunnyCheck] T1: "${text.slice(0, 60)}" → ${brand.display_name}`);
      injectBadge(el, brand); return;
    }
  }

  for (const text of tier2) {
    const brand = matchWithPrefixes(text);
    if (brand) {
      console.log(`[BunnyCheck] T2: "${text.slice(0, 60)}" → ${brand.display_name}`);
      injectBadge(el, brand); return;
    }
  }

  // Detail page fallback: brand element is outside the image's ancestor tree.
  // Only for images with NO brand element in their own card — a recommendation
  // carousel product has its own card brand, and badging it with the page's
  // brand would be wrong.
  if (!hasCardBrand) {
    const pageBrand = getUltaDetailPageBrand();
    if (pageBrand) {
      const brand = matchWithPrefixes(pageBrand);
      if (brand) {
        console.log(`[BunnyCheck] PDP: "${pageBrand}" → ${brand.display_name}`);
        injectBadge(el, brand); return;
      }
    }
  }

  el.setAttribute(PROCESSED_ATTR, "0");
}

// ─── Page scanner ─────────────────────────────────────────────────────────────

const observedElements = new WeakSet();

const intersectionObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        tryBadgeElement(entry.target);
      }
    }
  },
  { rootMargin: "100px" }
);

/**
 * Removes badge overlays whose image (or the host itself) was detached by a
 * framework re-render, and clears the processed mark so the image gets
 * re-badged if it comes back.
 */
function pruneBadges() {
  for (let i = activeBadges.length - 1; i >= 0; i--) {
    const { host, img } = activeBadges[i];
    if (!img.isConnected || !host.isConnected) {
      host.remove();
      img.removeAttribute(PROCESSED_ATTR);
      observedElements.delete(img);
      activeBadges.splice(i, 1);
    }
  }
}

function scanPage() {
  pruneBadges();

  document.querySelectorAll(`img:not([${PROCESSED_ATTR}])`).forEach((img) => {
    if (!observedElements.has(img)) {
      observedElements.add(img);
      intersectionObserver.observe(img);
    }
  });

  document.querySelectorAll(
    `[class*="product"]:not([${PROCESSED_ATTR}]),` +
    `[class*="item"]:not([${PROCESSED_ATTR}]),` +
    `[class*="card"]:not([${PROCESSED_ATTR}]),` +
    `[data-product-id]:not([${PROCESSED_ATTR}])`
  ).forEach((el) => {
    if (getBgImageUrl(el) && !observedElements.has(el)) {
      observedElements.add(el);
      intersectionObserver.observe(el);
    }
  });
}

// ─── MutationObserver ─────────────────────────────────────────────────────────

let mutationTimer = null;
const mutationObserver = new MutationObserver(() => {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(scanPage, 300);
});
mutationObserver.observe(document.body, { childList: true, subtree: true });

// ─── Console audit bridge ─────────────────────────────────────────────────────

document.addEventListener("bunnycheck-audit-request", () => {
  if (!window._bunnyMatcher) {
    document.dispatchEvent(new CustomEvent("bunnycheck-audit-response", {
      detail: { error: "BunnyCheck matcher not initialized yet." }
    }));
    return;
  }

  const results = { badges: [], misses: [] };
  const seen = new Set();
  const imgs = [...document.querySelectorAll("img")].filter(img =>
    img.src && !img.src.endsWith(".svg") && !img.src.includes("icon")
  );

  for (const img of imgs) {
    const { tier1, tier2 } = gatherNearbyText(img);
    let hit = null;

    for (const text of [...tier1, ...tier2]) {
      const b = matchWithPrefixes(text);
      if (b) { hit = { brand: b, via: text }; break; }
    }

    if (hit) {
      const key = hit.brand.display_name + "||" + (img.alt || "");
      if (!seen.has(key)) {
        seen.add(key);
        results.badges.push({
          img: (img.alt || img.src.slice(-40)).slice(0, 70),
          brand: hit.brand.display_name,
          peta: !!hit.brand.peta,
          lb: !!hit.brand.leaping_bunny,
          via: hit.via.slice(0, 80),
        });
      }
    } else if ((img.alt || "").length > 5) {
      results.misses.push((img.alt || img.src.slice(-50)).slice(0, 80));
    }
  }

  document.dispatchEvent(new CustomEvent("bunnycheck-audit-response", { detail: results }));
});

// ─── Initialisation ───────────────────────────────────────────────────────────

function init(attempt = 1) {
  chrome.storage.local.get("bunnycheck_brands", (result) => {
    const brands = result["bunnycheck_brands"];
    if (!brands || Object.keys(brands).length === 0) {
      if (attempt < 4) {
        setTimeout(() => init(attempt + 1), attempt * 1000);
      } else {
        console.warn("[BunnyCheck] Brand data not found in storage after retries.");
      }
      return;
    }
    window._bunnyMatcher = new BrandMatcher(brands);
    console.log("[BunnyCheck] Loaded", Object.keys(brands).length, "brands. Scanning page...");
    scanPage();
  });
}

if (document.body) {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);
}
