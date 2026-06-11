// scrape-sephora-brand-directory.mjs
// Scrapes Sephora's brand directory (https://www.sephora.com/brands-list) and
// diffs it against the researched dataset (data/ulta-brands-researched.csv +
// data/known-brands.json): brands Sephora stocks that we've never researched.
//
// Sephora is behind Akamai bot protection. /brands-list is one of the few
// pages that loads on a DIRECT goto (after a homepage warm-up); /shop/ grids
// do not — see recon-sephora.mjs. Headed bundled Chromium required.
//
// Sephora's header flyout keeps HIDDEN house-brand links (e.g. "Sephora
// Collection") in every page's DOM, so only visible links are collected —
// every real directory entry is visible in the A–Z list anyway.
//
// Writes data/sephora-brand-directory.txt (one display name per line) and
// prints the diff. Exit 2 if the page looks blocked/changed (nothing written).
//
// Run: node scripts/scrape-sephora-brand-directory.mjs

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "../data/ulta-brands-researched.csv");
const KNOWN_PATH = path.join(__dirname, "../data/known-brands.json");
const OUT_PATH = path.join(__dirname, "../data/sephora-brand-directory.txt");

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

const ctx = await chromium.launchPersistentContext("/tmp/bunnycheck-sephora-scrape-" + Date.now(), {
  headless: false,
  viewport: { width: 1366, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto("https://www.sephora.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.goto("https://www.sephora.com/brands-list", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);

// Scroll through in case any sections lazy-render.
for (let i = 0; i < 15; i++) {
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(300);
}

const { brands, blocked } = await page.evaluate(() => {
  const out = new Map();
  for (const a of document.querySelectorAll('a[href*="/brand/"]')) {
    if (a.offsetParent === null) continue; // hidden flyout duplicates
    const href = a.getAttribute("href") || "";
    const m = href.match(/\/brand\/([a-z0-9][a-z0-9-]*)\/?(?:[?#]|$)/i);
    if (!m) continue;
    const text = (a.innerText || a.textContent || "").trim().replace(/\s+/g, " ");
    if (text.length < 2 || text.length > 60) continue;
    if (!out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), text);
  }
  return {
    brands: [...out.values()],
    blocked: /access denied/i.test(document.title),
  };
});
await ctx.close();

if (blocked || brands.length < 200) {
  console.error(`Got ${brands.length} visible brand links${blocked ? " (Access Denied page)" : ""} — bot-blocked or page structure changed. Aborting without writing.`);
  process.exit(2);
}

brands.sort((a, b) => a.localeCompare(b));
writeFileSync(OUT_PATH, brands.join("\n") + "\n", "utf8");
console.log(`Scraped ${brands.length} brands from Sephora's directory → ${OUT_PATH}\n`);

// ─── Diff against the researched dataset ─────────────────────────────────────

function splitRow(line) {
  const cells = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === ",") { cells.push(cur); cur = ""; } else cur += ch; }
  }
  cells.push(cur); return cells;
}

const researched = new Set();
for (const line of readFileSync(CSV_PATH, "utf8").split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const c = splitRow(line);
  researched.add(norm(c[0]));
  if (c[1]) researched.add(norm(c[1].trim().replace(/-/g, " ")));
}
for (const name of JSON.parse(readFileSync(KNOWN_PATH, "utf8")).names) {
  researched.add(norm(name));
}

const newBrands = brands.filter(b => !researched.has(norm(b)));
console.log(`Already researched (${brands.length - newBrands.length}/${brands.length}).`);
console.log(`\nNEW on Sephora, never researched (${newBrands.length}):`);
for (const b of newBrands) console.log(`  + ${b}`);

if (newBrands.length) {
  console.log(`\nTo ingest:`);
  console.log(`  node scripts/scrape-sephora-brand-directory.mjs | grep '^  + ' | sed 's/^  + //' | node scripts/ingest-new-brands.mjs`);
}
