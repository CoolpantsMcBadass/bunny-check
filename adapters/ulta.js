// BunnyCheck — adapters/ulta.js
// Site adapter for Ulta (https://www.ulta.com).
//
// Exactly one adapter file loads per host, listed in the manifest BEFORE
// content.js. The core content script reads window._bunnyAdapter for
// everything site-specific:
//
//   id                      — short site identifier (logging/diagnostics)
//   brandSelectors          — selectors for the site's rendered brand-name
//                             elements; their text is vouched-for as a brand
//                             name (tier-0 / PDP fallback), so generic-named
//                             brands (essence, LUSH) may match it
//   maxBrandWalk            — ancestor levels for the tier-0 walk
//   maxCardText             — text length above which an ancestor spans more
//                             than one product card (boundary for both the
//                             tier-0 and tier-2 walks)
//   isProductDetailPage()   — true when the current URL is a product detail
//                             page, enabling the page-level brand fallback
//   observerAttributeFilter — attributes the MutationObserver watches in
//                             addition to childList; sites that reveal card
//                             text by flipping attributes need them listed
"use strict";

window._bunnyAdapter = {
  id: "ulta",

  // Ulta uses Polymer web components; class names follow pal-c-* and Text-*
  // patterns (grid cards + detail page).
  brandSelectors: [
    '[class*="Text-brandName"]',
    '[class*="ProductCard__brandName"]',
    '[class*="ProductCard-brandName"]',
    '[class*="brandName"]',
    '[class*="brand-name"]',
    '[data-testid="brand-name"]',
    '[data-testid="brand"]',
    '[itemprop="brand"]',
    'a[href*="/brand/"]',
  ],

  // Bounded to a single product card; maxCardText is large enough for
  // shade-heavy cards but stops the walk at grid/page level, where a
  // querySelector would return the FIRST brand element on the page.
  maxBrandWalk: 8,
  maxCardText: 1200,

  isProductDetailPage() {
    return /\/p\//.test(location.pathname);
  },

  // Ulta reveals cards by flipping attributes (data-visible / class) on text
  // that is already in the DOM, so a childList-only observer never fires for
  // them and the empty-text retry would wait forever.
  observerAttributeFilter: ["class", "style", "data-visible", "hidden"],
};
