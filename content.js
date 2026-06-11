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
  // z-index only needs to beat the (static) product img inside the card.
  // Anything high competes at the root stacking level and paints over
  // Ulta's sticky header when cards scroll beneath it.
  host.style.cssText = `position:absolute;left:${left}px;top:${top}px;transform:translateY(-100%);z-index:1;pointer-events:none;line-height:0;`;
  parent.appendChild(host);
  activeBadges.push({ host, img: imgEl });

  const shadow = host.attachShadow({ mode: "open" });

  const hasParentWarn = !!brandEntry.parent_cf_bad;

  // Typed counts for the on-page stats panel.
  host.setAttribute("data-bc-peta", hasPeta ? "1" : "0");
  host.setAttribute("data-bc-lb", hasLB ? "1" : "0");
  host.setAttribute("data-bc-warn", hasParentWarn ? "1" : "0");
  host.setAttribute("data-bc-brand", brandEntry.display_name || "");

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
      const text = (els[0].innerText || els[0].textContent || "").trim();
      // Multiple matches with DIFFERENT text means this ancestor spans more
      // than one product card (or a nav brand-link list) — abort the whole
      // walk. Nested wrappers and repeated same-brand elements (logo link +
      // name link) count as one.
      if (els.length > 1) {
        for (let j = 1; j < els.length; j++) {
          if (els[0].contains(els[j])) continue;
          const other = (els[j].innerText || els[j].textContent || "").trim();
          if (other !== text) return null;
        }
      }
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
 * Tier 0 — Ulta-specific brand name element (explicit DOM element, most
 *          reliable; kept separate because its text is vouched-for as a brand
 *          name, so generic-named brands like essence/LUSH may match it).
 * Tier 1 — the image's own attributes (alt, title, data-brand, aria-label).
 * Tier 2 — the product card ancestor's first line of rendered text.
 */
function gatherNearbyText(imgEl) {
  const tier1 = [];
  const tier2 = [];

  // Tier 0: Ulta-specific brand element in ancestor subtree.
  const tier0 = getUltaBrandFromAncestors(imgEl);

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

  return { tier0, tier1, tier2 };
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

// ─── Unknown-brand collector ──────────────────────────────────────────────────
// Brand names extracted from Ulta's own brand elements (tier 0 / PDP — text
// that is vouched-for as a brand name) that match neither the certified DB nor
// the known-brands list (every researched brand, certified or not) are new to
// us — Ulta started stocking something we've never researched. They're
// buffered locally and shown in the popup for export into the data pipeline.
// Nothing leaves the machine.

const UNKNOWN_KEY = "bunnycheck_unknown";
const UNKNOWN_CAP = 300;
const WIDGET_POS_KEY = "bunnycheck_widget_pos";
let knownNames = null; // Set of normalized names, loaded in init()
let savedWidgetPos = null; // { top, left } in px, loaded in init()
const reportedUnknowns = new Set(); // once per page load
const unknownBuffer = new Map(); // normalized → display text, pending flush
let unknownFlushTimer = null;

function recordUnknownBrand(rawText) {
  try {
    if (!knownNames || !window._bunnyNormalize) return;
    const display = rawText.trim().replace(/\s+/g, " ");
    if (display.length < 2 || display.length > 60) return;
    const norm = window._bunnyNormalize(display);
    if (!norm || norm.length < 2 || /^\d+$/.test(norm)) return;
    if (knownNames.has(norm) || reportedUnknowns.has(norm)) return;
    reportedUnknowns.add(norm);
    unknownBuffer.set(norm, display);
    clearTimeout(unknownFlushTimer);
    unknownFlushTimer = setTimeout(flushUnknownBrands, 2000);
  } catch (_) {}
}

function flushUnknownBrands() {
  const pending = new Map(unknownBuffer);
  unknownBuffer.clear();
  if (pending.size === 0) return;
  try {
    chrome.storage.local.get(UNKNOWN_KEY, (result) => {
      if (chrome.runtime.lastError) return;
      const stored = result[UNKNOWN_KEY] || {};
      const now = Date.now();
      for (const [norm, display] of pending) {
        if (stored[norm]) {
          stored[norm].count++;
          stored[norm].last = now;
        } else if (Object.keys(stored).length < UNKNOWN_CAP) {
          stored[norm] = { name: display, count: 1, first: now, last: now };
        }
      }
      chrome.storage.local.set({ [UNKNOWN_KEY]: stored });
    });
  } catch (_) {}
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/**
 * Tries the full text first, then progressively shorter word-prefixes (up to 4).
 * Prefix matching uses exact-only — no fuzzy — so shade names don't match brands.
 * `allowGeneric` is passed through: true only for tier-0 brand-element text.
 */
function matchWithPrefixes(text, allowGeneric = false) {
  if (!text) return null;
  const direct = window._bunnyMatcher.match(text, allowGeneric);
  if (direct) return direct;
  const words = text.trim().split(/\s+/);
  for (let i = Math.min(words.length - 1, 4); i >= 1; i--) {
    const prefix = words.slice(0, i).join(" ");
    const brand = window._bunnyMatcher.matchExact(prefix, allowGeneric);
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

  const { tier0, tier1, tier2 } = gatherNearbyText(el);

  // If no text was found at all, the card body hasn't rendered yet.
  // Drop from observedElements so the next scanPage() (fired by MutationObserver
  // when the card text loads) will re-observe and retry this element.
  if (!tier0 && tier1.length === 0 && tier2.length === 0) {
    intersectionObserver.unobserve(el);
    observedElements.delete(el);
    return;
  }

  intersectionObserver.unobserve(el);

  // Tier 0 is a dedicated brand-name element, so generic-named brands
  // (essence, LUSH, Hair+) are allowed to match here — and only here.
  // Full-string match ONLY: the element text is the complete brand name, so
  // word-prefix trimming would mismatch brands that extend another brand's
  // name ("Being Frenshe" is not "being").
  if (tier0) {
    const brand = window._bunnyMatcher.match(tier0, true);
    if (brand) {
      console.log(`[BunnyCheck] T0: "${tier0.slice(0, 60)}" → ${brand.display_name}`);
      injectBadge(el, brand); return;
    }
  }

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
  // brand would be wrong. The page brand element is also vouched-for text.
  if (!tier0) {
    const pageBrand = getUltaDetailPageBrand();
    if (pageBrand) {
      // Full-string match only — same reasoning as tier 0.
      const brand = window._bunnyMatcher.match(pageBrand, true);
      if (brand) {
        console.log(`[BunnyCheck] PDP: "${pageBrand}" → ${brand.display_name}`);
        injectBadge(el, brand); return;
      }
      recordUnknownBrand(pageBrand);
    }
  }

  // Nothing matched. If Ulta's own brand element named this product's brand,
  // that name is a real brand we've never researched — collect it.
  if (tier0) recordUnknownBrand(tier0);

  el.setAttribute(PROCESSED_ATTR, "0");
}

// ─── Stats widget ─────────────────────────────────────────────────────────────
// Small fixed bunny button top-right; click opens a panel with live page
// counts, database totals, and any new-to-us brands the collector has seen.

const WIDGET_ID = "bunnycheck-stats-widget";

function injectStatsWidget() {
  if (!document.body || document.getElementById(WIDGET_ID)) return;
  const host = document.createElement("div");
  host.id = WIDGET_ID;

  if (savedWidgetPos) {
    host.style.cssText = `position:fixed;top:${savedWidgetPos.top}px;left:${savedWidgetPos.left}px;z-index:2147483000;line-height:0;user-select:none;touch-action:none;`;
  } else {
    host.style.cssText = "position:fixed;top:5px;right:10px;z-index:2147483000;line-height:0;user-select:none;touch-action:none;";
  }

  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  let icon = "🐇";
  try {
    if (chrome.runtime && chrome.runtime.getURL) {
      icon = `<img src="${chrome.runtime.getURL("icons/bunny-64.png")}" width="26" height="26" alt="" draggable="false">`;
    }
  } catch (_) {}

  shadow.innerHTML = `
    <style>
      .btn { width:38px;height:38px;border-radius:50%;background:#fff;border:2px solid #2e7d32;
             box-shadow:0 2px 8px rgba(0,0,0,.18);cursor:pointer;display:flex;align-items:center;
             justify-content:center;padding:0;font-size:17px; }
      .btn:hover { background:#f1f8e9; }
      .btn.grabbing { cursor:grabbing; }
      img { -webkit-user-drag:none; pointer-events:none; }
      .panel { display:none;position:absolute;top:44px;right:0;width:252px;background:#fff;
               border:1px solid #c8e6c9;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.2);
               font:12px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1b2b1b;
               padding:12px 14px;text-align:left; }
      .panel.open { display:block; }
      .hd { font-size:13px;font-weight:700;color:#2e7d32;display:flex;justify-content:space-between;
            align-items:center;margin-bottom:4px; }
      .sec { font-size:10px;font-weight:600;margin:8px 0 1px;color:#558b2f;
             text-transform:uppercase;letter-spacing:.5px; }
      .row { display:flex;justify-content:space-between; }
      .v { font-weight:600;color:#2e7d32; }
      .v.warn { color:#b45309; }
      .unk { color:#4a4a4a;max-height:74px;overflow-y:auto;white-space:pre-line; }
      .muted { color:#888; }
      .x { cursor:pointer;border:none;background:none;font-size:14px;color:#888;padding:0 2px; }
    </style>
    <button class="btn" id="toggle" title="BunnyCheck stats — long-press to drag" aria-label="Open BunnyCheck statistics">${icon}</button>
    <div class="panel" id="panel" role="dialog" aria-label="BunnyCheck statistics"></div>
  `;

  const panel = shadow.getElementById("panel");
  const toggleBtn = shadow.getElementById("toggle");
  let dragging = false, didDrag = false;
  let dragOffsetX = 0, dragOffsetY = 0, dragStartX = 0, dragStartY = 0;
  const DRAG_THRESHOLD = 4;

  panel.addEventListener("click", (e) => {
    if (e.target && e.target.id === "close") panel.classList.remove("open");
  });

  function onDragMove(e) {
    if (!dragging) return;
    if (!didDrag) {
      if (Math.abs(e.clientX - dragStartX) > DRAG_THRESHOLD || Math.abs(e.clientY - dragStartY) > DRAG_THRESHOLD) didDrag = true;
    }
    if (!didDrag) return;
    const x = Math.max(0, Math.min(e.clientX - dragOffsetX, window.innerWidth  - host.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - dragOffsetY, window.innerHeight - host.offsetHeight));
    host.style.left = x + "px";
    host.style.top  = y + "px";
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    toggleBtn.classList.remove("grabbing");
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup",   onDragEnd);
    const wasDrag = didDrag;
    didDrag = false;
    if (wasDrag) {
      const rect = host.getBoundingClientRect();
      savedWidgetPos = { left: rect.left, top: rect.top };
      try { chrome.storage.local.set({ [WIDGET_POS_KEY]: savedWidgetPos }); } catch (_) {}
    } else {
      if (panel.classList.contains("open")) { panel.classList.remove("open"); }
      else { renderStatsPanel(panel); panel.classList.add("open"); }
    }
  }

  host.addEventListener("dragstart", (e) => e.preventDefault());
  host.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragOffsetX = e.clientX - rect.left; dragOffsetY = e.clientY - rect.top;
    dragging = true; didDrag = false;
    host.style.right = ""; host.style.left = rect.left + "px"; host.style.top = rect.top + "px";
    toggleBtn.classList.add("grabbing");
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup",   onDragEnd);
  });
}

function renderStatsPanel(panel) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

  // Live page counts from connected badge hosts.
  const hosts = [...document.querySelectorAll("[data-bunnycheck-badge]")].filter((h) => h.isConnected);
  const pagePeta = hosts.filter((h) => h.getAttribute("data-bc-peta") === "1").length;
  const pageLB = hosts.filter((h) => h.getAttribute("data-bc-lb") === "1").length;
  const pageWarn = hosts.filter((h) => h.getAttribute("data-bc-warn") === "1").length;
  const pageBrands = new Set(hosts.map((h) => h.getAttribute("data-bc-brand")).filter(Boolean));

  // Database totals.
  const db = Object.values(window._bunnyBrands || {});
  const dbPeta = db.filter((b) => b.peta).length;
  const dbLB = db.filter((b) => b.leaping_bunny).length;
  const dbBoth = db.filter((b) => b.peta && b.leaping_bunny).length;
  const dbWarn = db.filter((b) => b.parent_cf_bad).length;
  let version = "";
  for (const b of db) if (b.data_version && b.data_version > version) version = b.data_version;

  panel.innerHTML = `
    <div class="hd">BunnyCheck stats <button class="x" id="close" aria-label="Close">✕</button></div>
    <div class="sec">This page</div>
    <div class="row"><span>Products badged</span><span class="v">${hosts.length}</span></div>
    <div class="row"><span>Brands</span><span class="v">${pageBrands.size}</span></div>
    <div class="row"><span>PETA Cruelty-Free</span><span class="v">${pagePeta}</span></div>
    <div class="row"><span>Leaping Bunny</span><span class="v">${pageLB}</span></div>
    <div class="row"><span>⚠ Parent-company warnings</span><span class="v warn">${pageWarn}</span></div>
    <div class="sec">Database</div>
    <div class="row"><span>Certified brands</span><span class="v">${db.length}</span></div>
    <div class="row"><span>PETA</span><span class="v">${dbPeta}</span></div>
    <div class="row"><span>Leaping Bunny</span><span class="v">${dbLB}</span></div>
    <div class="row"><span>Both</span><span class="v">${dbBoth}</span></div>
    <div class="row"><span>Parent flagged</span><span class="v warn">${dbWarn}</span></div>
    <div class="row"><span>Data version</span><span class="v">${esc(version || "—")}</span></div>
    <div class="sec">New brands spotted</div>
    <div class="unk" id="unk"><span class="muted">None yet</span></div>
  `;

  try {
    chrome.storage.local.get(UNKNOWN_KEY, (result) => {
      const entries = Object.values((result || {})[UNKNOWN_KEY] || {});
      const unk = panel.querySelector("#unk");
      if (!unk || entries.length === 0) return;
      entries.sort((a, b) => b.count - a.count);
      unk.textContent = entries.map((e) => e.name).join("\n");
    });
  } catch (_) {}
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
  injectStatsWidget(); // re-add if an SPA re-render removed it

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
// Attributes are watched too: Ulta reveals cards by flipping attributes
// (data-visible / class) on text that is already in the DOM, so a
// childList-only observer never fires for them and the empty-text retry
// (v0.5.3/v0.5.5) would wait forever.
mutationObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class", "style", "data-visible", "hidden"],
});

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
    const { tier0, tier1, tier2 } = gatherNearbyText(img);
    let hit = null;

    if (tier0) {
      const b = window._bunnyMatcher.match(tier0, true);
      if (b) hit = { brand: b, via: tier0 };
    }
    if (!hit) {
      for (const text of [...tier1, ...tier2]) {
        const b = matchWithPrefixes(text);
        if (b) { hit = { brand: b, via: text }; break; }
      }
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
  chrome.storage.local.get(["bunnycheck_brands", "bunnycheck_known", WIDGET_POS_KEY], (result) => {
    const brands = result["bunnycheck_brands"];
    if (!brands || Object.keys(brands).length === 0) {
      if (attempt < 4) {
        setTimeout(() => init(attempt + 1), attempt * 1000);
      } else {
        console.warn("[BunnyCheck] Brand data not found in storage after retries.");
      }
      return;
    }
    const known = result["bunnycheck_known"];
    if (known && Array.isArray(known.names)) {
      knownNames = new Set(known.names);
    }
    const pos = result[WIDGET_POS_KEY];
    if (pos && typeof pos.top === "number" && typeof pos.left === "number") {
      savedWidgetPos = pos;
    }
    window._bunnyMatcher = new BrandMatcher(brands);
    window._bunnyBrands = brands; // for the stats panel's database section
    console.log("[BunnyCheck] Loaded", Object.keys(brands).length, "brands. Scanning page...");
    scanPage();
  });
}

if (document.body) {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);
}
