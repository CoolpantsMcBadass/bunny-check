// Sephora DOM recon — groundwork for adapters/sephora.js.
// Dumps product-grid tile structure, brand-element candidates, PDP brand
// markup, JSON-LD, and the brand directory. Read-only; nothing is written
// back to the site.
//
// Run: node scripts/recon-sephora.mjs
// Headed bundled Chromium. Findings from round 1: homepage and /brands-list
// load fine, but a direct goto to a /shop/ category grid gets Akamai
// "Access Denied" even after homepage warm-up. So this version navigates by
// CLICKING links from pages that load (brand directory → brand grid →
// product tile → PDP), which keeps the referer/session chain intact.
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

function section(name) {
  console.log(`\n${"═".repeat(70)}\n■ ${name}\n${"═".repeat(70)}`);
}

async function settle(ms = 5000) {
  await page.waitForTimeout(ms);
  console.log(`  title: ${await page.title()}  url: ${page.url()}`);
}

// Generic brand-element probe, shared by grid and PDP dumps.
const probeFn = () => {
  const out = { brandHits: [], dataCompTally: {}, dataAtTally: {} };
  const seen = new Set();

  for (const el of document.querySelectorAll("*")) {
    const comp = el.getAttribute("data-comp");
    if (comp) out.dataCompTally[comp] = (out.dataCompTally[comp] || 0) + 1;
    const dataAt = el.getAttribute("data-at");
    if (dataAt) out.dataAtTally[dataAt] = (out.dataAtTally[dataAt] || 0) + 1;

    for (const attr of el.attributes) {
      const hay = (attr.name + "=" + attr.value).toLowerCase();
      if (hay.includes("brand")) {
        const text = (el.innerText || el.textContent || "").trim().slice(0, 60);
        const key = `${el.tagName}|${attr.name}=${attr.value}|${text}`;
        if (!seen.has(key) && out.brandHits.length < 40) {
          seen.add(key);
          out.brandHits.push({
            tag: el.tagName.toLowerCase(),
            attr: `${attr.name}="${attr.value.slice(0, 80)}"`,
            text,
          });
        }
        break;
      }
    }
  }

  for (const k of Object.keys(out.dataAtTally)) {
    if (out.dataAtTally[k] < 3) delete out.dataAtTally[k];
  }
  return out;
};

const jsonLdFn = () => {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
    try {
      const o = JSON.parse(s.textContent);
      return { type: o["@type"], brand: o.brand, name: (o.name || "").slice(0, 60) };
    } catch {
      return { parseError: true };
    }
  });
};

function printProbe(label, probe) {
  console.log(`\n${label} data-comp tally:`, JSON.stringify(probe.dataCompTally, null, 2));
  console.log(`\n${label} repeated data-at values:`, JSON.stringify(probe.dataAtTally, null, 2));
  console.log(`\n${label} brand-attribute hits:`);
  for (const h of probe.brandHits) console.log(`  <${h.tag} ${h.attr}> "${h.text}"`);
}

try {
  section("1. Homepage warm-up");
  console.log("→ https://www.sephora.com/");
  await page.goto("https://www.sephora.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(6000);

  section("2. Brand directory (direct goto — known to load)");
  console.log("→ https://www.sephora.com/brands-list");
  await page.goto("https://www.sephora.com/brands-list", { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(5000);

  // Pick a normal single-brand link that is actually VISIBLE (the directory
  // keeps duplicate links in hidden flyouts), skip Sephora house brands and
  // tracking-param links, scroll to it, and click it in-page so the SPA
  // router handles navigation with the session chain intact.
  const brandHref = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href^="/brand/"]')];
    const pick = links.find((a) => {
      const h = a.getAttribute("href");
      const t = (a.innerText || "").trim();
      return (
        t.length > 1 && !h.includes("sephora-") && !h.includes("?") &&
        h.split("/").length === 3 && a.offsetParent !== null
      );
    });
    if (!pick) return null;
    pick.scrollIntoView({ block: "center" });
    return pick.getAttribute("href");
  });
  console.log("picked brand link:", brandHref);

  section("3. Brand grid (click-through)");
  if (!brandHref) throw new Error("No visible brand link found to click");
  await page.waitForTimeout(1000);
  await page.evaluate((h) => {
    const el = [...document.querySelectorAll(`a[href="${h}"]`)].find((a) => a.offsetParent !== null);
    el?.click();
  }, brandHref);
  await settle(7000);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(3000);

  const gridTitle = await page.title();
  if (/access denied/i.test(gridTitle)) {
    console.log("!! Brand grid ALSO blocked via click-through.");
  } else {
    const grid = await page.evaluate(probeFn);
    printProbe("grid", grid);

    const tile = await page.evaluate(() => {
      const cand =
        document.querySelector('[data-comp*="ProductTile" i]') ||
        document.querySelector('a[href*="/product/"]');
      if (!cand) return null;
      const a = cand.closest("a[href]") || cand.querySelector("a[href]") || cand;
      return {
        outerHTML: cand.outerHTML.slice(0, 3000),
        href: a.getAttribute("href"),
      };
    });
    console.log("\nfirst tile outerHTML (3000 chars):\n", tile?.outerHTML ?? "NOT FOUND");

    section("4. Product detail page (click-through)");
    if (tile?.href) {
      await page.evaluate((h) => {
        const el = document.querySelector(`a[href="${h}"]`);
        el?.scrollIntoView({ block: "center" });
        el?.click();
      }, tile.href);
      await settle(8000);
      if (/access denied/i.test(await page.title())) {
        console.log("!! PDP blocked via click-through.");
      } else {
        const pdp = await page.evaluate(probeFn);
        printProbe("PDP", pdp);
        console.log("\nPDP JSON-LD:", JSON.stringify(await page.evaluate(jsonLdFn), null, 2));
      }
    } else {
      console.log("No product tile link found — skipping PDP.");
    }
  }
} finally {
  await browser.close();
}
