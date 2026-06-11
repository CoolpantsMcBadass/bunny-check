# BunnyCheck

A Chrome MV3 extension that detects cruelty-free beauty brands near product images on **Ulta.com** and overlays **PETA Cruelty-Free** and **Leaping Bunny** certification badges on those images. When a certified brand is owned by a parent company that is *not* cruelty-free (sells in mainland China / tests on animals), an amber **"⚠ But... parent tests"** warning badge is shown alongside.

## How it works

1. On install, the background service worker (`background.js`) loads the bundled `data/brands.json` into `chrome.storage.local`. The content script reads it directly from storage (no message round-trip — avoids an MV3 cold-start race).
2. A `MutationObserver` (debounced 300 ms) + `IntersectionObserver` pair finds product images as they enter the viewport, including dynamically loaded grid cards.
3. For each image, `content.js` gathers brand-name candidates in three tiers:
   - **Tier 0** — the site's explicit brand-name DOM element (selectors supplied by the site adapter; for Ulta: `Text-brandName`, `data-testid="brand"`, etc.), searched within the image's own product card only (the walk stops at the card boundary so neighboring cards can't cross-match). Brands whose name is a common English word (essence, LUSH, Hair+ — flagged `generic_name` at build time) match **only** here, so category tiles like "Nails" or "Hair" never badge.
   - **Tier 1** — the image's own attributes (`alt`, `title`, `aria-label`, `data-brand`).
   - **Tier 2** — the first rendered text line of the product-card ancestor.
   - **PDP fallback** — on `/p/` product detail pages, where the brand element is structurally unrelated to the image gallery, the page-level brand element is used — but only for images that have no card brand of their own (so recommendation carousels aren't badged with the page's brand).
4. Candidates are matched by `BrandMatcher` (`matcher.js`): exact normalized lookup first, then word-boundary-gated fuzzy matching, then exact-only word-prefix trimming ("Brand Product Name" → "Brand").
5. Matches get a badge overlay anchored to the image's bottom-left corner. The overlay is appended beside the image — the image itself is never reparented, so Ulta's framework re-renders don't break. Orphaned badges are pruned and re-applied on each rescan. Images under 80 px wide get a small color-coded dot instead of full badges.

## File structure

```
bunny-check/
  manifest.json            — MV3 manifest (Ulta-only host permissions)
  background.js            — Service worker: data loading, caching, remote refresh
  content.js               — Site-agnostic core: page scanner, brand extraction, badge injection
  matcher.js               — BrandMatcher class
  adapters/
    ulta.js                — Ulta site adapter: brand selectors, card bounds, PDP detection,
                             observer attribute filter (one adapter loads per host, before content.js)
  data/
    brands.json            — 374 certified Ulta brands (PETA 247 / LB 171 / both 44; 52 parent warnings)
    brands-master.csv      — Full merged PETA+LB dataset (8,859 brands)
    brands-researched.csv  — Manual parent-company research (in progress)
    peta-raw.txt           — Clean PETA brand list (6,822)
    lb-raw.txt             — Clean Leaping Bunny brand list (2,325)
    wikidata-parents.tsv   — Wikidata subsidiary→parent pairs for bad parents
    SOURCES.md             — Data provenance documentation
  scripts/
    build-ulta-brands-json.mjs — Builds brands.json from ulta-brands-researched.csv (current pipeline)
    build-brands-json.mjs      — Builds from brands-master.csv (full-DB pipeline, unused since v0.6.0)
    build-brand-csv.mjs        — Merges peta-raw.txt + lb-raw.txt into brands-master.csv
    scrape-peta-names.mjs      — PETA WP REST API scraper
    scrape-lb-names.mjs        — Leaping Bunny shopping-guide scraper
    fix-peta-flags.mjs         — Corrects CF vs does-test flags from PETA API
    verify-ulta-csv.mjs        — Live-verifies peta=FALSE rows against PETA page H1s (--apply to write)
    smoke-test.mjs             — Playwright regression test of the matching pipeline (16 checks)
    console-audit.js           — Paste into DevTools console for a full-page match audit
    diagnose.mjs               — Playwright DOM diagnosis helper
  badges/                  — PETA / Leaping Bunny badge SVG artwork
  popup/                   — Popup UI (brand counts, data version)
  icons/                   — Extension icons (placeholders — replace before store submission)
```

## Brand data

`data/brands.json` contains **374 Ulta-stocked certified brands**, keyed by Ulta brand slug, verified against:

- **PETA Beauty Without Bunnies** — https://www.peta.org/living/personal-care-fashion/beauty-without-bunnies/
- **Leaping Bunny brand search** — https://www.leapingbunny.org/guide/brands

Parent-company status (the "⚠ parent tests" warning) comes from manual research recorded in `data/brands-researched.csv`. Known data corrections (PETA typos, stale entries like Estée Lauder) are documented in `changelog.txt`; a denylist in the build script prevents known-bad entries from re-entering on rebuild.

Rebuild with: `node scripts/build-ulta-brands-json.mjs`

See `data/SOURCES.md` for full provenance notes.

## Loading in Chrome (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `bunny-check/` folder
4. Visit https://www.ulta.com and browse any product grid or product page

Note: `node_modules/` (Playwright, used only by `scripts/`) must be excluded if you ever pack or zip the extension for the Chrome Web Store.

## Auditing matches on a live page

Paste the contents of `scripts/console-audit.js` into the DevTools console on an Ulta page. It uses a DOM-event bridge into the content script's isolated world and prints every badge hit and miss with the text that triggered it.

## Remote data refresh

`background.js` contains a `REMOTE_DATA_URL` constant pointing to the raw `brands.json` on GitHub. Once the repo is live, the extension checks every 7 days and pulls newer data when the `data_version` advances.

## Reporting issues / missing brands

Open an issue at: https://github.com/CoolpantsMcBadass/bunny-check/issues
