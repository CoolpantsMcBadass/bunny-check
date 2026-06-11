# BunnyCheck

A Chrome MV3 extension that detects cruelty-free beauty brands near product images on **Ulta.com** and **Sephora.com** and overlays **PETA Cruelty-Free** and **Leaping Bunny** certification badges on those images. When a certified brand is owned by a parent company that is *not* cruelty-free (sells in mainland China / tests on animals), an amber **"⚠ But... parent tests"** warning badge is shown alongside.

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
  manifest.json            — MV3 manifest (Ulta + Sephora host permissions)
  background.js            — Service worker: data loading, caching, remote refresh
  content.js               — Site-agnostic core: page scanner, brand extraction, badge injection
  matcher.js               — BrandMatcher class
  adapters/
    ulta.js                — Ulta site adapter: brand selectors, card bounds, PDP detection,
                             observer attribute filter (one adapter loads per host, before content.js)
    sephora.js             — Sephora site adapter (ProductTile spans, data-at testids,
                             DisplayName-only PDP brand selector)
  data/
    brands.json            — 473 certified brands across Ulta + Sephora catalogs
                             (PETA 293 / LB 245 / both 65; 64 parent warnings)
    retailer-brands-researched.csv — Canonical research CSV: every brand seen at a
                             supported retailer (Ulta + Sephora; 1,187 rows), with
                             PETA/LB flags, parent research, and cross-retailer aliases
    brands-master.csv      — Full merged PETA+LB dataset (8,859 brands)
    brands-researched.csv  — Older manual parent-company research (superseded)
    peta-raw.txt           — Clean PETA brand list (6,822)
    lb-raw.txt             — Leaping Bunny brand list, CCIC programme (2,325)
    cfi-lb-raw.txt         — Leaping Bunny brand list, Cruelty Free International
                             programme (403) — the second licensor of the mark
    wikidata-parents.tsv   — Wikidata subsidiary→parent pairs for bad parents
    SOURCES.md             — Data provenance documentation
  scripts/
    build-ulta-brands-json.mjs — Builds brands.json from retailer-brands-researched.csv (current pipeline)
    build-brands-json.mjs      — Builds from brands-master.csv (full-DB pipeline, unused since v0.6.0)
    build-brand-csv.mjs        — Merges peta-raw.txt + lb-raw.txt into brands-master.csv
    scrape-peta-names.mjs      — PETA WP REST API scraper
    scrape-lb-names.mjs        — Leaping Bunny (CCIC) shopping-guide scraper
    scrape-cfi-lb-names.mjs    — Leaping Bunny (CFI) approved-brands directory scraper
    fix-peta-flags.mjs         — Corrects CF vs does-test flags from PETA API
    verify-ulta-csv.mjs        — Live-verifies peta=FALSE rows against PETA page H1s (--apply to write)
    smoke-test.mjs             — Playwright regression test of the matching pipeline (21 checks)
    recon-sephora.mjs          — Sephora DOM recon (click-through navigation beats the bot wall)
    scrape-sephora-brand-directory.mjs — Sephora /brands-list scraper + diff vs researched dataset
    live-test-sephora.mjs      — Live Sephora check with the extension loaded (headed Chromium)
    console-audit.js           — Paste into DevTools console for a full-page match audit
    diagnose.mjs               — Playwright DOM diagnosis helper
  badges/                  — PETA / Leaping Bunny badge SVG artwork
  popup/                   — Popup UI (brand counts, data version)
  icons/                   — Extension icons (placeholders — replace before store submission)
```

## Brand data

`data/brands.json` contains **473 certified brands** from the Ulta and Sephora catalogs, keyed by brand slug, verified against:

- **PETA Beauty Without Bunnies** — https://www.peta.org/living/personal-care-fashion/beauty-without-bunnies/
- **Leaping Bunny (CCIC) brand search** — https://www.leapingbunny.org/guide/brands
- **Leaping Bunny (Cruelty Free International) approved brands** — https://www.crueltyfreeinternational.org/approved-brands/

Two organizations license the same Leaping Bunny mark — CCIC (leapingbunny.org, North America) and CFI (international). The LB sweep (`verify-lb-names.mjs`) checks both lists and reports which one matched; UK/EU brands like REFY, Benefit, Garnier, and The INKEY List appear only on CFI's. Note that CFI approval can coexist with a "not cruelty-free" PETA listing (Benefit) — the badges report each organization's position independently, and the amber parent warning still applies (Benefit/LVMH, Garnier/L'Oréal, philosophy/Coty).

Parent-company status (the "⚠ parent tests" warning) comes from manual research recorded in the `parent_company` / `parent_cf` / `notes` columns of `data/retailer-brands-researched.csv`. Known data corrections (PETA typos, stale entries like Estée Lauder) are documented in `changelog.txt`; a denylist in the build script prevents known-bad entries from re-entering on rebuild.

Rebuild with: `node scripts/build-ulta-brands-json.mjs`

See `data/SOURCES.md` for full provenance notes.

## Loading in Chrome (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `bunny-check/` folder
4. Visit https://www.ulta.com or https://www.sephora.com and browse any product grid or product page

The database covers both catalogs: Sephora's full brand directory was researched 2026-06-10 (Glossier, MERIT, Glow Recipe, Summer Fridays, rhode, …). Where the two retailers display different names for one brand ("BondiBoost" vs "Bondi Boost"), the CSV's `aliases` column maps the variants to a single entry.

Note: `node_modules/` (Playwright, used only by `scripts/`) must be excluded if you ever pack or zip the extension for the Chrome Web Store.

## Auditing matches on a live page

Paste the contents of `scripts/console-audit.js` into the DevTools console on an Ulta page. It uses a DOM-event bridge into the content script's isolated world and prints every badge hit and miss with the text that triggered it.

## Remote data refresh

`background.js` contains a `REMOTE_DATA_URL` constant pointing to the raw `brands.json` on GitHub. Once the repo is live, the extension checks every 7 days and pulls newer data when the `data_version` advances.

## Reporting issues / missing brands

Open an issue at: https://github.com/CoolpantsMcBadass/bunny-check/issues
