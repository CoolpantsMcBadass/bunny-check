// scrape-ulta-brand-directory.mjs
// Scrapes Ulta's A–Z brand directory (https://www.ulta.com/brand) and diffs it
// against data/retailer-brands-researched.csv: brands Ulta added that we've never
// researched, and researched brands Ulta no longer lists.
//
// Ulta is behind Akamai bot protection: plain fetch and headless browsers get
// the "Our Apologies" page, so this launches Playwright's bundled Chromium
// HEADED (a window will open briefly). Don't switch to channel:'chrome' —
// branded Chrome ignores --load-extension and (more importantly here)
// current versions are fingerprinted differently; bundled Chromium headed is
// the combination that works (v0.6.7 finding).
//
// Writes data/ulta-brand-directory.txt (one display name per line) and prints
// the diff. Exit code 0 even when differences exist; parse the output.
//
// Run: node scripts/scrape-ulta-brand-directory.mjs

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "../data/retailer-brands-researched.csv");
const OUT_PATH = path.join(__dirname, "../data/ulta-brand-directory.txt");

function norm(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/['’]/g, "").replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// ─── Scrape ───────────────────────────────────────────────────────────────────

const ctx = await chromium.launchPersistentContext("/tmp/bunnycheck-scrape-profile-" + Date.now(), {
  headless: false,
  viewport: { width: 1300, height: 900 },
});
const page = ctx.pages()[0] ?? await ctx.newPage();
// Warm up via the homepage first: hitting /brand/all cold trips Akamai's
// "Our Apologies" block; arriving with homepage cookies does not.
await page.goto("https://www.ulta.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.goto("https://www.ulta.com/brand/all", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

// Dismiss the cookie banner if present so lazy content can load.
const cookieBtn = await page.$("text=I Understand");
if (cookieBtn) { await cookieBtn.click().catch(() => {}); await page.waitForTimeout(1000); }

// The directory may lazy-render sections; scroll through the page.
for (let i = 0; i < 25; i++) {
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(400);
}

const brands = await page.evaluate(() => {
  const out = new Map();
  for (const a of document.querySelectorAll('a[href*="/brand/"]')) {
    const href = a.getAttribute("href") || "";
    // Brand pages look like /brand/<slug>; skip the directory root and deep links.
    const m = href.match(/\/brand\/([a-z0-9][a-z0-9-]*)\/?(?:[?#]|$)/i);
    if (!m || m[1] === "all") continue;
    const text = (a.innerText || a.textContent || "").trim().replace(/\s+/g, " ");
    if (text.length < 2 || text.length > 60) continue;
    if (!out.has(m[1])) out.set(m[1], text);
  }
  return [...out.values()];
});
await ctx.close();

if (brands.length < 100) {
  console.error(`Only ${brands.length} brand links found — page structure changed or bot-blocked. Aborting without writing.`);
  process.exit(2);
}

brands.sort((a, b) => a.localeCompare(b));
writeFileSync(OUT_PATH, brands.join("\n") + "\n", "utf8");
console.log(`Scraped ${brands.length} brands from Ulta's directory → ${OUT_PATH}\n`);

// ─── Diff against the research CSV ────────────────────────────────────────────

function splitRow(line) {
  const cells = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === ",") { cells.push(cur); cur = ""; } else cur += ch; }
  }
  cells.push(cur); return cells;
}

const lines = readFileSync(CSV_PATH, "utf8").split(/\r?\n/).slice(1).filter(l => l.trim());
const researched = new Set();
for (const line of lines) {
  const c = splitRow(line);
  researched.add(norm(c[0]));
  if (c[1]) researched.add(c[1].trim().replace(/-/g, " "));
}

const newBrands = brands.filter(b => !researched.has(norm(b)));
console.log(`NEW on Ulta, not in research CSV (${newBrands.length}):`);
for (const b of newBrands) console.log(`  + ${b}`);

const directoryNorms = new Set(brands.map(norm));
const csvNames = lines.map(l => splitRow(l)[0]);
const dropped = csvNames.filter(n => !directoryNorms.has(norm(n)));
console.log(`\nIn research CSV but NOT in Ulta's directory (${dropped.length}) —` +
  ` discontinued, renamed, or directory page miss; informational only:`);
for (const n of dropped.slice(0, 60)) console.log(`  - ${n}`);
if (dropped.length > 60) console.log(`  ... and ${dropped.length - 60} more`);

if (newBrands.length) {
  console.log(`\nTo ingest the new brands:`);
  console.log(`  node scripts/scrape-ulta-brand-directory.mjs | grep '^  + ' | sed 's/^  + //' | node scripts/ingest-new-brands.mjs`);
}
