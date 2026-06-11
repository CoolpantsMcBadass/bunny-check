// BunnyCheck — adapters/sephora.js
// Site adapter for Sephora (https://www.sephora.com).
// Adapter contract is documented in adapters/ulta.js; DOM findings come from
// scripts/recon-sephora.mjs (see changelog 2026-06-10).
"use strict";

window._bunnyAdapter = {
  id: "sephora",

  // Sephora is React: css-* classes are hashed per build, but data-comp /
  // data-at testids and the ProductTile-content class are stable.
  //
  // Deliberately NO bare a[href*="/brand/"] selector here — Sephora's header
  // flyout keeps hidden house-brand links (Sephora Collection) in every
  // page's DOM, which would poison any whole-document brand query.
  brandSelectors: [
    // Grid/carousel tile: the brand is the first span of the tile body.
    ".ProductTile-content > span:first-child",
    // Comparison tables and rec carousels carry an explicit brand testid.
    '[data-at="product_brand_label"]',
  ],

  // PDP page-level brand: the h1 brand link inside the DisplayName component
  // ONLY — the tile selectors above also exist on PDPs (recommendation
  // carousels) and must not become the page brand.
  pdpBrandSelectors: ['[data-comp~="DisplayName"] a[href^="/brand/"]'],

  // Tile depth: img → picture → ProductImage → wrapper → <a> → ProductTile;
  // the brand span lives inside the <a>, well within 8 levels. Tile text
  // (brand + name + price + reviews + flags) stays far under 1200 chars.
  maxBrandWalk: 8,
  maxCardText: 1200,

  isProductDetailPage() {
    return /\/product\//.test(location.pathname);
  },

  // React re-renders insert/remove nodes (childList covers most), but lazy
  // tiles ([data-comp~="LazyLoad"]) reveal via class/style flips.
  observerAttributeFilter: ["class", "style", "hidden"],
};
