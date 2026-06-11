// Live Sephora verification — loads the real extension in headed bundled
// Chromium and walks brands-list → Tarte brand grid → first PDP, counting
// injected badges at each stop. Navigation is click-through (SPA router):
// direct goto to grid pages trips Sephora's bot wall (see recon-sephora.mjs).
//
// Run: node scripts/live-test-sephora.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const EXT = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = mkdtempSync(join(tmpdir(), "bunnycheck-sephora-"));

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false, // headless gets bot-blocked
  viewport: { width: 1366, height: 900 },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--disable-blink-features=AutomationControlled",
  ],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("console", (m) => {
  if (m.text().includes("BunnyCheck")) console.log("[page]", m.text());
});

const snapshot = () =>
  page.evaluate(() => {
    const hosts = [...document.querySelectorAll("[data-bunnycheck-badge]")].filter((h) => h.isConnected);
    return {
      title: document.title.slice(0, 70),
      url: location.href.slice(0, 100),
      badges: hosts.length,
      brands: [...new Set(hosts.map((h) => h.getAttribute("data-bc-brand")))],
      widget: !!document.getElementById("bunnycheck-stats-widget"),
    };
  });

const clickHref = (href) =>
  page.evaluate((h) => {
    const el =
      [...document.querySelectorAll(`a[href="${h}"]`)].find((a) => a.offsetParent !== null) ||
      document.querySelector(`a[href="${h}"]`);
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, href);

console.log("■ Homepage warm-up (also lets the service worker seed storage)");
await page.goto("https://www.sephora.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

console.log("■ Brands list");
await page.goto("https://www.sephora.com/brands-list", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);

console.log("■ Click through to Tarte brand grid");
const clicked = await clickHref("/brand/tarte");
if (!clicked) throw new Error("No /brand/tarte link found on brands-list");
await page.waitForTimeout(8000);
await page.mouse.wheel(0, 1500);
await page.waitForTimeout(4000);

const grid = await snapshot();
console.log("GRID:", JSON.stringify(grid, null, 2));

console.log("■ Click through to first product PDP");
const pdpHref = await page.evaluate(() => {
  const a = document.querySelector('[data-comp~="ProductTile"] a[href*="/product/"]');
  if (!a) return null;
  a.scrollIntoView({ block: "center" });
  a.click();
  return a.getAttribute("href");
});
console.log("clicked:", pdpHref);
await page.waitForTimeout(9000);

const pdp = await snapshot();
console.log("PDP:", JSON.stringify(pdp, null, 2));

await ctx.close();

const ok =
  grid.badges > 0 &&
  grid.brands.includes("Tarte") &&
  !/access denied/i.test(grid.title) &&
  pdp.badges > 0;
console.log(
  `\n${ok ? "PASS" : "FAIL"}  grid badges=${grid.badges} (${grid.brands.join(", ")}), pdp badges=${pdp.badges} (${pdp.brands.join(", ")})`
);
process.exit(ok ? 0 : 1);
