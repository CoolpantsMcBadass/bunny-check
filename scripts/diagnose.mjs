// BunnyCheck — diagnose.mjs
// Simulates the full extension matching pipeline in a real browser page.
// Since MV3 service workers don't register in Playwright, we inject the
// brands.json and matching logic directly into the page context and run
// findProductCardAncestor + gatherNearbyText + BrandMatcher ourselves.

import { chromium } from "playwright";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Sites to check: [label, url]
const SITES = [
  ["Ulta — New Arrivals makeup", "https://www.ulta.com/makeup?sortBy=new&pageSize=96"],
  ["Ulta — New Arrivals skincare", "https://www.ulta.com/skin-care?sortBy=new&pageSize=96"],
];

// Load brands.json and matcher source from disk.
const brandsJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "../data/brands.json"), "utf8")
);
const matcherSrc = readFileSync(path.resolve(__dirname, "../matcher.js"), "utf8");
const contentSrc = readFileSync(path.resolve(__dirname, "../content.js"), "utf8");

// Extract just the functions we need from content.js (everything up to scanPage).
// We'll inject matcher.js + a slimmed simulation harness.
const simHarness = `
if (window.__bunnyHarnessLoaded) { /* already injected */ } else {
window.__bunnyHarnessLoaded = true;
${matcherSrc}

const PRODUCT_CARD_PATTERNS = [/product/i, /\\bcard\\b/i, /\\btile\\b/i, /\\bsku\\b/i, /\\bpdp\\b/i];
const MAX_ANCESTOR_WALK = 12;

function findProductCardAncestor(el) {
  let node = el;
  for (let i = 0; i < MAX_ANCESTOR_WALK; i++) {
    if (!node.parentElement) break;
    node = node.parentElement;
    const hasStableAttr =
      node.hasAttribute("data-product-id") ||
      node.hasAttribute("data-sku") ||
      node.hasAttribute("data-sku-id") ||
      node.hasAttribute("data-item-id") ||
      (node.getAttribute("data-test") || "").toLowerCase().includes("product") ||
      (node.getAttribute("itemtype") || "").includes("Product");
    const combinedStr = node.className + " " + node.id + " " + (node.getAttribute("itemtype") || "");
    const hasClassMatch = PRODUCT_CARD_PATTERNS.some(re => re.test(combinedStr));
    if (hasStableAttr || hasClassMatch) {
      const textLen = node.textContent.trim().length;
      if (textLen > 15 && textLen < 600) return node;
    }
  }
  return null;
}

function gatherNearbyText(imgEl) {
  const tier1 = [];
  const tier2 = [];
  for (const attr of ["alt", "title", "aria-label", "data-product-name", "data-brand"]) {
    const val = imgEl.getAttribute(attr);
    if (val) tier1.push(val);
  }
  const card = findProductCardAncestor(imgEl);
  if (!card) return { tier1, tier2, cardInfo: null };
  const cardInfo = {
    classes: card.className.slice(0, 80),
    textLen: card.textContent.trim().length,
    text: card.textContent.trim().replace(/\\s+/g, " ").slice(0, 150),
  };
  card.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(h => {
    const t = h.textContent.trim(); if (t) tier2.push(t);
  });
  card.querySelectorAll("p, span, a, [class*='brand'], [class*='name'], [class*='title']").forEach(el => {
    if (el.children.length > 3) return;
    const t = el.textContent.trim();
    if (t && t.length <= 120) tier2.push(t);
  });
  return { tier1, tier2, cardInfo };
}

function matchWithPrefixes(matcher, text) {
  if (!text) return null;
  const direct = matcher.match(text);
  if (direct) return { brand: direct, matchedText: text };
  const words = text.trim().split(/\\s+/);
  for (let i = Math.min(words.length - 1, 4); i >= 1; i--) {
    const prefix = words.slice(0, i).join(" ");
    const brand = matcher.matchExact(prefix);
    if (brand) return { brand, matchedText: prefix };
  }
  return null;
}

window.__gatherNearbyText = gatherNearbyText;
window.__matchWithPrefixes = matchWithPrefixes;
window.__BrandMatcher = BrandMatcher;
window.__bunnySimulate = function(brands) {
  const matcher = new BrandMatcher(brands);
  const results = [];
  const imgs = [...document.querySelectorAll("img")].filter(img => img.src && !img.src.includes("placeholder") && !img.src.includes("icon") && !img.src.includes(".svg"));

  for (const img of imgs.slice(0, 40)) {
    const { tier1, tier2, cardInfo } = gatherNearbyText(img);
    let matched = null;
    let tier = null;

    for (const text of tier1) {
      const m = matchWithPrefixes(matcher, text);
      if (m) { matched = m; tier = "T1"; break; }
    }
    if (!matched) {
      for (const text of tier2) {
        const brand = matcher.match(text);
        if (brand) { matched = { brand, matchedText: text }; tier = "T2"; break; }
      }
    }

    results.push({
      alt: (img.alt || "").slice(0, 70),
      src: img.src.slice(-50),
      tier1,
      tier2: tier2.slice(0, 5),
      cardInfo,
      matched: matched ? { tier, brand: matched.brand.display_name, text: matched.matchedText.slice(0, 60) } : null,
    });
  }
  return results;
};
} // end __bunnyHarnessLoaded guard
`;

async function scrollAndLoadMore(page, rounds) {
  for (let round = 0; round < rounds; round++) {
    // Scroll to bottom gradually.
    for (let i = 1; i <= 5; i++) {
      await page.evaluate(f => window.scrollTo(0, document.body.scrollHeight * f), i * 0.2);
      await page.waitForTimeout(600);
    }
    // Look for a "Load More" button and click it.
    const loadMore = await page.$([
      "button:has-text('Load More')",
      "button:has-text('load more')",
      "button:has-text('Show More')",
      "a:has-text('Load More')",
      "[data-test='load-more-btn']",
      ".load-more button",
      ".pal-c-Button--loadMore",
    ].join(", "));
    if (loadMore) {
      console.log(`  Round ${round + 1}: clicking Load More...`);
      await loadMore.click();
      await page.waitForTimeout(2500);
    } else {
      console.log(`  Round ${round + 1}: no Load More button found — stopping.`);
      break;
    }
  }
}

async function checkSite(ctx, label, url) {
  console.log(`\n${"=".repeat(60)}\n${label}\n${url}\n${"=".repeat(60)}`);
  const page = await ctx.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const title = await page.title();
  console.log(`Page title: "${title}"`);
  if (title.toLowerCase().includes("waiting room") || title.toLowerCase().includes("be right back")) {
    console.log("  Ulta is in a waiting room / maintenance mode — skipping.");
    await page.close();
    return;
  }

  await page.waitForTimeout(3000);

  // Scroll + load more 4 rounds.
  console.log("Scrolling and loading more products...");
  await scrollAndLoadMore(page, 4);

  // Final scroll back to top.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  const imgCount = await page.evaluate(() => document.querySelectorAll("img").length);
  console.log(`Total images in DOM: ${imgCount}`);

  // Inject simulation harness.
  await page.evaluate(simHarness);

  // Run simulation — no slice limit, check all product images.
  const results = await page.evaluate((brands) => {
    const matcher = new window.__BrandMatcher(brands);
    const gatherNearbyText = window.__gatherNearbyText;
    const matchWithPrefixes = window.__matchWithPrefixes;
    const imgs = [...document.querySelectorAll("img")].filter(img =>
      img.src && !img.src.includes("placeholder") && !img.src.includes("icon") && !img.src.endsWith(".svg")
    );
    return imgs.map(img => {
      const { tier1, tier2, cardInfo } = gatherNearbyText(img);
      let matched = null, tier = null;
      for (const text of tier1) {
        const m = matchWithPrefixes(matcher, text);
        if (m) { matched = m; tier = "T1"; break; }
      }
      if (!matched) {
        for (const text of tier2) {
          const brand = matcher.match(text);
          if (brand) { matched = { brand, matchedText: text }; tier = "T2"; break; }
        }
      }
      return {
        alt: (img.alt || "").slice(0, 80),
        tier1,
        tier2: tier2.slice(0, 5),
        cardInfo,
        matched: matched ? { tier, brand: matched.brand.display_name, text: matched.matchedText.slice(0, 70) } : null,
      };
    });
  }, brandsJson);

  // Deduplicate by brand+alt to collapse primary/hover pairs.
  const seen = new Set();
  const deduped = results.filter(r => {
    if (!r.matched) return false;
    const key = `${r.matched.brand}||${r.alt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Separate true matches from anything suspicious.
  console.log(`\n=== BADGE MATCHES (${deduped.length} unique) ===\n`);
  for (const r of deduped) {
    const m = r.matched;
    console.log(`[${m.tier}] "${r.alt.slice(0, 60)}" → ${m.brand}`);
    if (m.tier === "T2") {
      // Show the card text so we can verify it's not cross-contamination.
      console.log(`     matched text: "${m.text}"`);
      if (r.cardInfo) console.log(`     card: "${r.cardInfo.text.slice(0, 100)}"`);
    }
  }

  const noMatch = results.filter(r => !r.matched && r.alt.length > 5);
  console.log(`\n=== UNMATCHED product images (${noMatch.length}) ===`);
  for (const r of noMatch.slice(0, 30)) {
    console.log(`  "${r.alt.slice(0, 70)}"`);
  }
  if (noMatch.length > 30) console.log(`  ... and ${noMatch.length - 30} more`);

  console.log(`\nTotal: ${deduped.length} badges, ${results.filter(r=>!r.matched).length} skipped, ${results.length} images scanned`);
  await page.close();
}

(async () => {
  const ctx = await chromium.launchPersistentContext("", {
    executablePath: CHROME_PATH,
    headless: false,
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  for (const [label, url] of SITES) {
    await checkSite(ctx, label, url);
  }

  await ctx.close();
})();
