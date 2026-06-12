// scrape-ulta-brands.mjs
// ARCHIVED (2026-06-12): original bootstrap scraper from 2026-06-07 — produced
// data/ulta-brands.csv, the seed list for the whole research pipeline.
// Superseded by scripts/scrape-ulta-brand-directory.mjs (Playwright; Ulta's
// Akamai bot wall now blocks plain fetch). Kept for provenance.
//
// Scrapes all brand names from ulta.com/brand/all and writes ulta-brands.csv
// Run with: node scripts/archive/scrape-ulta-brands.mjs

import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "../../data/ulta-brands.csv");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function main() {
  console.log("Fetching https://www.ulta.com/brand/all ...");
  const res = await fetch("https://www.ulta.com/brand/all", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Extract from the alphabetical brand list section:
  // href="https://www.ulta.com/brand/<slug>"><div class="pal-c-Link__label"><display name></div>
  const pattern = /href="https:\/\/www\.ulta\.com\/brand\/([^"]+)"[^>]*><div class="pal-c-Link__label">([^<]+)<\/div>/g;
  const seen = new Map();
  for (const m of html.matchAll(pattern)) {
    const slug = m[1];
    const name = m[2].trim();
    if (!seen.has(slug)) seen.set(slug, name);
  }

  // Remove the meta-page itself
  seen.delete("all");

  const brands = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  console.log(`Found ${brands.length} brands`);

  const lines = ["brand_name,ulta_slug"];
  for (const [slug, name] of brands) {
    const safeName = name.includes(",") || name.includes('"') ? `"${name.replace(/"/g, '""')}"` : name;
    lines.push(`${safeName},${slug}`);
  }

  writeFileSync(OUT_PATH, lines.join("\n") + "\n", "utf8");
  console.log(`Written: ${OUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
