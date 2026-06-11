// BunnyCheck — build-ulta-brands-json.mjs
// Builds data/brands.json from data/retailer-brands-researched.csv.
// Only includes brands certified by PETA or Leaping Bunny (peta=TRUE or leaping_bunny=TRUE).
// Also emits data/known-brands.json: normalized names + aliases of EVERY
// researched row (certified or not), so the content script's unknown-brand
// collector only reports brands we have never researched.
//
// Run with: node scripts/build-ulta-brands-json.mjs

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH  = path.join(__dirname, "../data/retailer-brands-researched.csv");
const OUT_PATH  = path.join(__dirname, "../data/brands.json");
const KNOWN_PATH = path.join(__dirname, "../data/known-brands.json");
const VERSION   = new Date().toISOString().slice(0, 10);

// ─── CSV parser ───────────────────────────────────────────────────────────────

function splitCSVRow(line) {
  const cells = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { cells.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const header = splitCSVRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitCSVRow(lines[i]);
    const obj = {};
    header.forEach((h, j) => { obj[h] = cells[j] ?? ""; });
    rows.push(obj);
  }
  return rows;
}

// ─── Generic-word detection ──────────────────────────────────────────────────
// A matcher key that is a single common English word ("nails", "hair", "rare")
// will exact-match category tiles, nav links, and ordinary page text.
// Generated aliases that come out generic are dropped; brands whose actual
// NAME is a generic word (essence, Lush, Hair+) are kept but flagged
// generic_name so the matcher only accepts them from a brand-name element.

const CATEGORY_TERMS = new Set([
  "nails", "nail", "hair", "makeup", "skincare", "skin", "fragrance",
  "perfume", "cologne", "bath", "body", "tools", "brushes", "gifts", "gift",
  "men", "mens", "women", "womens", "wellness", "sale", "new", "minis",
  "mini", "travel", "clearance", "brands", "beauty",
]);

let DICT = null;
function isCommonWord(word) {
  if (CATEGORY_TERMS.has(word)) return true;
  if (DICT === null) {
    try {
      DICT = new Set(
        readFileSync("/usr/share/dict/words", "utf8").split("\n").map(w => w.toLowerCase())
      );
    } catch {
      DICT = new Set(); // no system dictionary — category terms still apply
    }
  }
  return DICT.has(word);
}

// Same normalization the matcher applies, so we test what actually gets indexed.
function normalizeKey(str) {
  return str
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericKey(str) {
  const norm = normalizeKey(str);
  return !norm.includes(" ") && !norm.includes("-") && isCommonWord(norm);
}

// ─── Alias generation ─────────────────────────────────────────────────────────

const STRIP_SUFFIXES = [
  /\s+(cosmetics?|beauty|skincare|skin care|haircare|hair care|fragrances?|parfums?|laboratories?|labs?|organics?|naturals?|wellness|professional|pro)\s*$/i,
];
const LEGAL_SUFFIX = /,?\s+(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|gmbh|plc|ag|s\.a\.s\.?|s\.r\.l\.?|pty\.?)\s*$/i;

function generateAliases(displayName, ulta_slug) {
  const variants = new Set();

  const clean = displayName.replace(/[®™©℗]/g, "").replace(/\s+/g, " ").trim();
  if (clean !== displayName) variants.add(clean);

  const noLegal = clean.replace(LEGAL_SUFFIX, "").trim();
  if (noLegal !== clean) variants.add(noLegal);

  for (const re of STRIP_SUFFIXES) {
    const s1 = noLegal.replace(re, "").trim();
    if (s1 && s1 !== noLegal && s1.length >= 3) variants.add(s1);
    const s2 = clean.replace(re, "").trim();
    if (s2 && s2 !== clean && s2.length >= 3) variants.add(s2);
  }

  const ascii = clean.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (ascii !== clean) {
    variants.add(ascii);
    const asciiNoLegal = ascii.replace(LEGAL_SUFFIX, "").trim();
    if (asciiNoLegal !== ascii) variants.add(asciiNoLegal);
  }

  if (clean.includes("'")) {
    variants.add(clean.replace(/'/g, "").replace(/\s+/g, " ").trim());
  }

  // Slug as alias: "rare-beauty" → "rare beauty"
  const slugAsName = ulta_slug.replace(/-/g, " ");
  if (slugAsName !== clean.toLowerCase()) variants.add(slugAsName);

  // Ampersand/and variants
  if (clean.includes(" & ")) variants.add(clean.replace(/ & /g, " and "));
  if (clean.toLowerCase().includes(" and ")) variants.add(clean.replace(/ and /gi, " & "));

  variants.delete(displayName);
  variants.delete(displayName.trim());

  // Drop derived aliases that collapse to a single common word — "Nails Inc."
  // minus the legal suffix is "Nails", which would badge the Nails category
  // tile. The full display name (and the slug alias) still match the brand.
  return [...variants].filter(v => v.length >= 2 && v !== displayName && !isGenericKey(v));
}

// ─── Denylist ─────────────────────────────────────────────────────────────────
// Slugs that appear on PETA's site but are known to test on animals.
// These override peta=TRUE from the CSV.
const PETA_DENYLIST = new Set([
  "estee-lauder",   // ELC tests for China market; on PETA's site erroneously
]);

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const rows = parseCSV(readFileSync(CSV_PATH, "utf8"));
  console.log(`Loaded ${rows.length} brands from retailer-brands-researched.csv`);

  const brands = {};

  for (const row of rows) {
    const name = (row.brand_name || "").trim();
    const slug = (row.ulta_slug  || "").trim();
    if (!name || !slug) continue;

    let peta = row.peta === "TRUE";
    const lb = row.leaping_bunny === "TRUE";
    if (PETA_DENYLIST.has(slug)) peta = false;
    if (!peta && !lb) continue;

    // Manual aliases (pipe-separated CSV column): other retailers' display
    // names for the same brand ("BondiBoost" for "Bondi Boost"). Unlike
    // generated aliases these are deliberate, so generic ones are kept — but
    // they force generic_name so they only match from a brand-name element.
    const manual = (row.aliases || "").split("|").map(s => s.trim()).filter(s => s.length >= 2);

    // Use ulta_slug as the key — it's already unique and URL-clean
    if (brands[slug]) {
      brands[slug].peta = brands[slug].peta || peta;
      brands[slug].leaping_bunny = brands[slug].leaping_bunny || lb;
      continue;
    }

    // parent_cf: "FALSE" = parent sells in China (known bad); anything else = not flagged
    const parent_cf_bad = (row.parent_cf || "").trim() === "FALSE";
    const parent_company = (row.parent_company || "").trim();

    // Brand whose name IS a common word (essence, Lush, Hair+): keep it, but
    // the matcher will only accept it from a dedicated brand-name element.
    const generic_name = isGenericKey(name) || manual.some(a => isGenericKey(a));

    brands[slug] = {
      display_name:    name,
      ulta_slug:       slug,
      aliases:         [...new Set([...generateAliases(name, slug), ...manual])],
      peta,
      leaping_bunny:   lb,
      parent_cf_bad,
      parent_company:  parent_company || undefined,
      generic_name:    generic_name || undefined,
      data_version:    VERSION,
    };
  }

  const all = Object.values(brands);
  const petaOnly = all.filter(b =>  b.peta && !b.leaping_bunny).length;
  const lbOnly   = all.filter(b => !b.peta &&  b.leaping_bunny).length;
  const both     = all.filter(b =>  b.peta &&  b.leaping_bunny).length;

  console.log(`\nBuilt ${all.length} Ulta-specific brand entries`);
  console.log(`  PETA only: ${petaOnly}`);
  console.log(`  LB only:   ${lbOnly}`);
  console.log(`  Both:      ${both}`);

  const json = JSON.stringify(brands, null, 2);
  writeFileSync(OUT_PATH, json, "utf8");
  console.log(`\nWritten: ${OUT_PATH} (${(json.length / 1024).toFixed(0)} KB)`);

  // Known-brands list: every researched row, certified or not. The unknown-
  // brand collector treats anything NOT in this list as new-to-us. Aliases
  // are included so e.g. "Chanel Beauté" doesn't report when the CSV row says
  // "CHANEL".
  const known = new Set();
  for (const row of rows) {
    const name = (row.brand_name || "").trim();
    const slug = (row.ulta_slug  || "").trim();
    if (!name || !slug) continue;
    known.add(normalizeKey(name));
    known.add(slug.replace(/-/g, " "));
    for (const alias of generateAliases(name, slug)) known.add(normalizeKey(alias));
    for (const alias of (row.aliases || "").split("|")) {
      if (alias.trim().length >= 2) known.add(normalizeKey(alias.trim()));
    }
  }
  known.delete("");
  const knownJson = JSON.stringify({ data_version: VERSION, names: [...known].sort() });
  writeFileSync(KNOWN_PATH, knownJson, "utf8");
  console.log(`Written: ${KNOWN_PATH} (${(knownJson.length / 1024).toFixed(0)} KB, ${known.size} known names)`);
}

main();
