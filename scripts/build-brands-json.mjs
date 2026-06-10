// BunnyCheck — build-brands-json.mjs
// Converts bunny_DB/brands-master.csv → data/brands.json
//
// brands.json shape:
//   { [brand_key]: { display_name, aliases, peta, leaping_bunny, data_version } }
//
// Run with: node scripts/build-brands-json.mjs

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH  = path.join(__dirname, "../bunny_DB/brands-master.csv");
const OUT_PATH  = path.join(__dirname, "../data/brands.json");
const VERSION   = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// ─── CSV parser ───────────────────────────────────────────────────────────────
// Handles quoted fields with embedded commas and doubled-quote escapes.

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

function splitCSVRow(line) {
  const cells = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { cells.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  cells.push(cur);
  return cells;
}

// ─── Key generation ───────────────────────────────────────────────────────────

function makeBrandKey(name) {
  return name
    .toLowerCase()
    .replace(/[®™©℗]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

// ─── Alias generation ─────────────────────────────────────────────────────────
// Returns an array of variant strings worth indexing (deduped, filtered).

const STRIP_SUFFIXES = [
  /\s+(cosmetics?|beauty|skincare|skin care|haircare|hair care|fragrances?|parfums?|laboratories?|labs?|organics?|naturals?|wellness|professional|pro)\s*$/i,
];

const LEGAL_SUFFIX = /,?\s+(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|gmbh|plc|ag|s\.a\.s\.?|s\.r\.l\.?|pty\.?)\s*$/i;

function generateAliases(displayName) {
  const variants = new Set();

  // Strip trademark/copyright symbols → clean base
  const clean = displayName
    .replace(/[®™©℗]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (clean !== displayName) variants.add(clean);

  // Strip legal suffixes
  const noLegal = clean.replace(LEGAL_SUFFIX, "").trim();
  if (noLegal !== clean) variants.add(noLegal);

  // Strip product-category suffixes from the legal-stripped version
  for (const re of STRIP_SUFFIXES) {
    const short = noLegal.replace(re, "").trim();
    if (short && short !== noLegal && short.length >= 3) variants.add(short);
    const shortClean = clean.replace(re, "").trim();
    if (shortClean && shortClean !== clean && shortClean.length >= 3) variants.add(shortClean);
  }

  // Accent-strip variant (é→e, ü→u, etc.)
  const ascii = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (ascii !== clean) {
    variants.add(ascii);
    // Also accent-stripped + no legal
    const asciiNoLegal = ascii.replace(LEGAL_SUFFIX, "").trim();
    if (asciiNoLegal !== ascii) variants.add(asciiNoLegal);
  }

  // Apostrophe variants: L'Oréal → LOreal, l oreal
  if (clean.includes("'")) {
    variants.add(clean.replace(/'/g, "").replace(/\s+/g, " ").trim());
    variants.add(clean.replace(/'\w+/g, " $&").replace(/'/g, "").replace(/\s+/g, " ").trim());
  }

  // Remove the display name itself from aliases (it's already indexed by display_name)
  variants.delete(displayName);
  variants.delete(displayName.trim());

  // Filter: keep only aliases that are meaningfully different and >= 2 chars
  return [...variants].filter(v => v.length >= 2 && v !== displayName);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const raw = readFileSync(CSV_PATH, "utf8");
  const rows = parseCSV(raw);
  console.log(`Loaded ${rows.length} rows from brands-master.csv`);

  const brands = {};
  let dupeCount = 0;

  for (const row of rows) {
    const name = (row.brand_name || "").trim();
    if (!name) continue;

    const peta = row.peta === "TRUE";
    const lb   = row.leaping_bunny === "TRUE";

    // Skip rows where neither cert is true (shouldn't happen but be safe)
    if (!peta && !lb) continue;

    const key = makeBrandKey(name);
    if (!key) continue;

    if (brands[key]) {
      // Merge: if same name appears in both PETA and LB rows, OR-merge certs
      brands[key].peta = brands[key].peta || peta;
      brands[key].leaping_bunny = brands[key].leaping_bunny || lb;
      dupeCount++;
      continue;
    }

    brands[key] = {
      display_name:  name,
      aliases:       generateAliases(name),
      peta,
      leaping_bunny: lb,
      data_version:  VERSION,
    };
  }

  // Stats
  const all = Object.values(brands);
  const petaOnly = all.filter(b =>  b.peta && !b.leaping_bunny).length;
  const lbOnly   = all.filter(b => !b.peta &&  b.leaping_bunny).length;
  const both     = all.filter(b =>  b.peta &&  b.leaping_bunny).length;

  console.log(`\nBuilt ${all.length} unique brand entries (${dupeCount} key collisions merged)`);
  console.log(`  PETA only: ${petaOnly}`);
  console.log(`  LB only:   ${lbOnly}`);
  console.log(`  Both:      ${both}`);

  const json = JSON.stringify(brands, null, 2);
  writeFileSync(OUT_PATH, json, "utf8");
  console.log(`\nWritten: ${OUT_PATH} (${(json.length / 1024).toFixed(0)} KB)`);
}

main();
