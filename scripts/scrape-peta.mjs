// scrape-peta.mjs
// Fetches all brand slugs from PETA's crueltyfree.peta.org sitemaps,
// converts slugs to display names, and outputs entries for brands.json.
// Run with: node scripts/scrape-peta.mjs

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRANDS_PATH = path.join(__dirname, "../data/brands.json");
const TODAY = new Date().toISOString().slice(0, 10);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Brands that appear in PETA's sitemap but should NOT be included.
// Reasons: parent company sells in China, PETA listing is erroneous, or brand is a retailer.
const DENYLIST = new Set([
  // LVMH / sells in China
  "dior", "christian-dior", "givenchy", "lvmh",
  // Reversed cruelty-free status to enter China market
  "nars", "nars-cosmetics",
  // Estée Lauder parent + subsidiaries — EL sells in China
  "estee-lauder", "clinique", "mac", "mac-cosmetics", "bobbi-brown",
  "la-mer", "origins", "aveda", "bumble-and-bumble", "smashbox",
  "glamglow", "editions-de-parfums-frederic-malle", "kilian-paris",
  "le-labo", "tom-ford-beauty", "jo-malone-london", "aerin-beauty",
  "bumble-and-bumble-2", "lab-series",
  // L'Oréal parent + subsidiaries — L'Oréal sells in China
  "loreal", "l-oreal", "l-oreal-paris", "lancome", "ysl-beauty",
  "yves-saint-laurent-beaute", "ralph-lauren-fragrances", "armani-beauty",
  "helena-rubinstein", "shu-uemura", "kiehl-s", "kiehls",
  "maybeline", "maybelline", "garnier", "redken", "matrix",
  "cerave-2", "la-roche-posay-2",
  // Retailers (not brands)
  "sephora", "ulta", "ulta-beauty",
]);

const SITEMAPS = [
  "https://crueltyfree.peta.org/company-sitemap.xml",
  "https://crueltyfree.peta.org/company-sitemap2.xml",
  "https://crueltyfree.peta.org/company-sitemap3.xml",
  "https://crueltyfree.peta.org/company-sitemap4.xml",
  "https://crueltyfree.peta.org/company-sitemap5.xml",
  "https://crueltyfree.peta.org/company-sitemap6.xml",
  "https://crueltyfree.peta.org/company-sitemap7.xml",
];

// ─── Slug → display name conversion ──────────────────────────────────────────

// Words that should stay lowercase in a title (unless first word).
const LOWERCASE_WORDS = new Set(["a","an","the","and","but","or","for","nor","on","at","to","by","in","of","up","as","is"]);

// Known special-case replacements: slug fragment → correct rendering.
const SPECIAL_TOKENS = {
  "e-l-f": "e.l.f.",
  "st": "St.",
  "dr": "Dr.",
  "mr": "Mr.",
  "mrs": "Mrs.",
  "ms": "Ms.",
  "co": "Co.",
  "inc": "Inc.",
  "llc": "LLC",
  "usa": "USA",
  "uk": "UK",
  "nyc": "NYC",
  "la": "LA",
  "cbd": "CBD",
  "spf": "SPF",
  "uv": "UV",
};

/**
 * Converts a URL slug to a best-effort display name.
 * e.g. "too-faced" → "Too Faced"
 *      "e-l-f-cosmetics" → "e.l.f. Cosmetics"
 */
function slugToDisplayName(slug) {
  // Check full-slug special cases first.
  if (SPECIAL_TOKENS[slug]) return SPECIAL_TOKENS[slug];

  const words = slug.split("-");
  const result = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lower = word.toLowerCase();

    if (SPECIAL_TOKENS[lower]) {
      result.push(SPECIAL_TOKENS[lower]);
      continue;
    }

    // Check for e.l.f.-style pattern (single letters separated by hyphens).
    // This is pre-handled at the slug level via SPECIAL_TOKENS above.

    if (i > 0 && LOWERCASE_WORDS.has(lower)) {
      result.push(lower);
    } else {
      result.push(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    }
  }

  return result.join(" ");
}

/**
 * Generates alias variants from a slug and display name.
 */
function generateAliases(slug, displayName) {
  const aliases = new Set();
  aliases.add(displayName.toLowerCase());
  aliases.add(slug.replace(/-/g, " "));
  // Also add without common suffixes for broader matching.
  const noSuffix = displayName.toLowerCase()
    .replace(/\b(cosmetics|beauty|skincare|makeup|labs?|studio|botanicals?|organics?|naturals?|care)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (noSuffix && noSuffix !== displayName.toLowerCase()) aliases.add(noSuffix);
  return [...aliases].filter(Boolean);
}

/**
 * Converts a display name to a safe JSON key.
 * e.g. "Too Faced" → "too_faced"
 */
function toKey(slug) {
  return slug.replace(/-/g, "_").toLowerCase();
}

// ─── Sitemap fetching ─────────────────────────────────────────────────────────

async function fetchSitemap(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const xml = await res.text();
  // Extract all <loc> values that are brand pages (contain /company/<slug>/).
  const matches = [...xml.matchAll(/<loc>(https:\/\/crueltyfree\.peta\.org\/company\/([^/]+)\/)<\/loc>/g)];
  return matches.map(m => ({ url: m[1], slug: m[2] })).filter(b => b.slug !== "");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Loading existing brands.json...");
  const existing = JSON.parse(readFileSync(BRANDS_PATH, "utf8"));
  const existingKeys = new Set(Object.keys(existing));

  console.log(`Existing brands: ${existingKeys.size}`);
  console.log("Fetching PETA sitemaps...");

  const allBrands = [];
  for (const sitemapUrl of SITEMAPS) {
    process.stdout.write(`  ${sitemapUrl} ... `);
    try {
      const brands = await fetchSitemap(sitemapUrl);
      console.log(`${brands.length} brands`);
      allBrands.push(...brands);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  console.log(`\nTotal slugs from sitemaps: ${allBrands.length}`);

  // Deduplicate slugs.
  const seen = new Set();
  const unique = allBrands.filter(b => {
    if (seen.has(b.slug)) return false;
    seen.add(b.slug);
    return true;
  });
  console.log(`Unique slugs: ${unique.length}`);

  // Build new entries, skipping those already in the DB.
  const newEntries = {};
  let skipped = 0;

  for (const { slug } of unique) {
    const key = toKey(slug);
    if (existingKeys.has(key)) { skipped++; continue; }
    if (DENYLIST.has(slug)) { skipped++; continue; }

    const displayName = slugToDisplayName(slug);
    const aliases = generateAliases(slug, displayName);

    newEntries[key] = {
      display_name: displayName,
      aliases,
      peta: true,
      leaping_bunny: false, // PETA list doesn't imply LB certification
      data_version: TODAY,
      last_verified: TODAY,
    };
  }

  console.log(`Skipped (already in DB): ${skipped}`);
  console.log(`New entries to add: ${Object.keys(newEntries).length}`);

  // Merge and write.
  const merged = { ...existing, ...newEntries };
  writeFileSync(BRANDS_PATH, JSON.stringify(merged, null, 2));
  console.log(`\nDone. brands.json now has ${Object.keys(merged).length} entries.`);
  console.log(`Written to: ${BRANDS_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
