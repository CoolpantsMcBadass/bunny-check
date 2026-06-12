// scrape-lb-names.mjs
// Fetches all brand display names from Leaping Bunny's shopping guide.
// Pages through https://www.leapingbunny.org/shopping-guide?page=N
// Writes a sorted plain-text list to data/lb-raw.txt.
// Run with: node scripts/scrape-lb-names.mjs

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "../data/lb-raw.txt");

const BASE = "https://www.leapingbunny.org/shopping-guide";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── HTML entity decoding ─────────────────────────────────────────────────────

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'",
  "&apos;": "'", "&nbsp;": " ", "&reg;": "\u00AE", "&trade;": "\u2122",
  "&copy;": "\u00A9",
};

function decodeEntities(str) {
  str = str.replace(/&[#\w]+;/g, m => ENTITIES[m] ?? m);
  str = str.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
  str = str.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return str;
}

// ─── Fetch one page ───────────────────────────────────────────────────────────

async function fetchPage(pageNum) {
  const url = pageNum === 0 ? BASE : `${BASE}?page=${pageNum}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${pageNum}`);
  const html = await res.text();

  // Extract brand names from <a href="/brand/...">Brand Name</a>
  const matches = [...html.matchAll(/href="\/brand\/[^"]+"\s*[^>]*>([^<]+)<\/a>/g)];
  return matches
    .map(m => decodeEntities(m[1].trim()).replace(/\s+/g, " "))
    .filter(name => name.length > 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allNames = [];
  let page = 0;

  console.log("Scanning Leaping Bunny shopping guide...");

  while (true) {
    process.stdout.write(`  Page ${page}... `);
    const names = await fetchPage(page);
    console.log(`${names.length} brands`);
    if (names.length === 0) break;
    allNames.push(...names);
    page++;
    // Small delay to be polite
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nTotal fetched: ${allNames.length}`);

  // Deduplicate
  const seen = new Set();
  const dupes = [];
  const unique = [];
  for (const n of allNames) {
    if (seen.has(n)) { dupes.push(n); } else { seen.add(n); unique.push(n); }
  }
  if (dupes.length > 0) {
    console.log(`Deduplicated ${dupes.length} duplicates:`);
    dupes.forEach(d => console.log(`  "${d}"`));
  }

  // Sort case-insensitively
  unique.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const output = unique.join("\n") + "\n";
  writeFileSync(OUT_PATH, output);
  console.log(`\nWritten to: ${OUT_PATH}`);
  console.log(`Final count: ${unique.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
