// scrape-peta-names.mjs
// Fetches all brand display names from PETA's WordPress REST API.
// Writes a sorted plain-text list to data/peta-raw.txt (one name per line).
// Run with: node scripts/scrape-peta-names.mjs

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "../data/peta-raw.txt");

const BASE = "https://crueltyfree.peta.org/wp-json/wp/v2/company";
const PER_PAGE = 100;
const CONCURRENCY = 5;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Slugs to exclude — same logic as scrape-peta.mjs DENYLIST plus retailers.
// These will be omitted from peta-raw.txt entirely.
const SLUG_DENYLIST = new Set([
  "dior","christian-dior","givenchy","lvmh",
  "nars","nars-cosmetics",
  "estee-lauder","clinique","mac","mac-cosmetics","bobbi-brown",
  "la-mer","origins","aveda","bumble-and-bumble","smashbox",
  "glamglow","editions-de-parfums-frederic-malle","kilian-paris",
  "le-labo","tom-ford-beauty","jo-malone-london","aerin-beauty",
  "bumble-and-bumble-2","lab-series",
  "loreal","l-oreal","l-oreal-paris","lancome","ysl-beauty",
  "yves-saint-laurent-beaute","ralph-lauren-fragrances","armani-beauty",
  "helena-rubinstein","shu-uemura","kiehl-s","kiehls",
  "maybeline","maybelline","garnier","redken","matrix",
  "cerave-2","la-roche-posay-2",
  "sephora","ulta","ulta-beauty",
]);

// ─── HTML entity decoding ─────────────────────────────────────────────────────

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'",
  "&#8216;": "\u2018", "&#8217;": "\u2019", "&#8220;": "\u201C", "&#8221;": "\u201D",
  "&#8211;": "\u2013", "&#8212;": "\u2014", "&#038;": "&", "&#8230;": "\u2026",
  "&nbsp;": " ", "&reg;": "\u00AE", "&trade;": "\u2122", "&copy;": "\u00A9",
};

function decodeEntities(str) {
  // Named/numeric entities via lookup table.
  str = str.replace(/&[#\w]+;/g, m => ENTITIES[m] ?? m);
  // Remaining decimal numeric entities: &#NNN;
  str = str.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
  // Remaining hex numeric entities: &#xHHH;
  str = str.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return str;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchPage(page) {
  const url = `${BASE}?per_page=${PER_PAGE}&_fields=id,slug,title&page=${page}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 400) return null; // past last page
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
  const data = await res.json();
  // WP REST returns empty array when page is out of range
  if (!Array.isArray(data) || data.length === 0) return null;
  return data;
}

// Run up to `limit` promises concurrently.
async function mapConcurrent(items, limit, fn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Probe page 1 to get total count from headers.
  console.log("Probing page 1...");
  const probe = await fetch(
    `${BASE}?per_page=${PER_PAGE}&_fields=id,slug,title&page=1`,
    { headers: { "User-Agent": UA } }
  );
  if (!probe.ok) throw new Error(`HTTP ${probe.status} on probe`);

  const total = parseInt(probe.headers.get("X-WP-Total") || "0", 10);
  const totalPages = parseInt(probe.headers.get("X-WP-TotalPages") || "0", 10);

  const firstPage = await probe.json();
  console.log(`Total brands reported by API: ${total}`);
  console.log(`Total pages: ${totalPages || "unknown — will scan until empty"}`);

  const allEntries = [...firstPage];

  // Determine page range. If headers are missing, scan until we get null.
  const maxPage = totalPages > 0 ? totalPages : 200; // 200 × 100 = 20,000 safety cap
  const pages = Array.from({ length: maxPage - 1 }, (_, i) => i + 2); // pages 2..N

  console.log(`Fetching pages 2–${maxPage} with concurrency ${CONCURRENCY}...`);

  let done = 0;
  const chunks = [];
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    chunks.push(pages.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const results = await Promise.all(chunk.map(fetchPage));
    for (const result of results) {
      if (result === null) { done = pages.length; break; } // hit end
      allEntries.push(...result);
    }
    process.stdout.write(`\r  Fetched ${allEntries.length} brands so far...`);
    if (done) break;
  }

  console.log(`\nTotal fetched: ${allEntries.length}`);

  // Filter denylist and extract display names.
  const names = [];
  let denied = 0;
  for (const entry of allEntries) {
    if (SLUG_DENYLIST.has(entry.slug)) { denied++; continue; }
    const name = decodeEntities((entry.title?.rendered || "").trim());
    if (name) names.push(name);
  }

  console.log(`Denied (denylist): ${denied}`);
  console.log(`Clean brand names: ${names.length}`);

  // Deduplicate (API shouldn't have dupes but be safe).
  const seen = new Set();
  const dupes = [];
  const unique = [];
  for (const n of names) {
    if (seen.has(n)) { dupes.push(n); } else { seen.add(n); unique.push(n); }
  }
  if (dupes.length > 0) {
    console.log(`Deduplicated ${dupes.length} duplicates:`);
    dupes.forEach(d => console.log(`  "${d}"`));
  }

  // Sort case-insensitively, same as LB.txt style.
  unique.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const output = unique.join("\n") + "\n";
  writeFileSync(OUT_PATH, output);
  console.log(`\nWritten to: ${OUT_PATH}`);
  console.log(`Final count: ${unique.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
