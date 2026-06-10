// fix-peta-flags.mjs
// Fetches all companies from PETA's WP REST API, identifies which are truly CF
// (those with product-type taxonomy terms assigned), and corrects any peta=TRUE
// flags in brands-master.csv that belong to does-test or may-not-be brands.
//
// After running this, re-run build-brands-json.mjs to rebuild brands.json.
// Run with: node scripts/fix-peta-flags.mjs

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH  = path.join(__dirname, "../bunny_DB/brands-master.csv");
const API_BASE  = "https://crueltyfree.peta.org/wp-json/wp/v2/company";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Name normalization ───────────────────────────────────────────────────────
// Strips parenthetical parent names (e.g. "Neutrogena (Johnson & Johnson)" → "neutrogena"),
// trademark symbols, punctuation; lowercases and collapses whitespace.

function norm(name) {
  return name
    .replace(/\s*\([^)]*\)/g, "")      // "Foo (Bar & Co)" → "Foo"
    .replace(/[®™©℗]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// ─── PETA API fetch ───────────────────────────────────────────────────────────

async function fetchAllCompanies() {
  const cfSet       = new Set();   // product-type.length > 0  → cruelty-free
  const doesTestSet = new Set();   // product-type.length === 0 → not CF / may not be

  let page = 1;
  let totalPages = null;

  while (true) {
    const url = `${API_BASE}?per_page=100&page=${page}&_fields=id,slug,title,product-type`;
    process.stdout.write(`  page ${page}${totalPages ? `/${totalPages}` : ""}...`);

    const res = await fetch(url, { headers: { "User-Agent": UA } });

    if (res.status === 400) { console.log(" (past last page)"); break; }
    if (!res.ok) throw new Error(`HTTP ${res.status} for page ${page}`);

    if (totalPages === null) {
      const total = res.headers.get("X-WP-Total");
      totalPages   = parseInt(res.headers.get("X-WP-TotalPages") || "1");
      console.log(` (${total} total companies, ${totalPages} pages)`);
    } else {
      console.log("");
    }

    const companies = await res.json();
    if (!companies.length) break;

    for (const c of companies) {
      const raw = c.title?.rendered || c.slug || "";
      const key = norm(raw);
      if (!key) continue;

      if (Array.isArray(c["product-type"]) && c["product-type"].length > 0) {
        cfSet.add(key);
      } else {
        doesTestSet.add(key);
      }
    }

    if (page >= totalPages) break;
    page++;

    // Polite delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 150));
  }

  return { cfSet, doesTestSet };
}

// ─── CSV parser / writer ──────────────────────────────────────────────────────

function splitRow(line) {
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { cells.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  cells.push(cur);
  return cells;
}

function quoteCell(v) {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const header = splitRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitRow(lines[i]);
    const obj = {};
    header.forEach((h, j) => { obj[h] = cells[j] ?? ""; });
    rows.push(obj);
  }
  return { header, rows };
}

function serializeCSV(header, rows) {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map(h => quoteCell(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching all companies from PETA WP REST API...");
  const { cfSet, doesTestSet } = await fetchAllCompanies();
  console.log(`\nCruelty-free (product-type > 0):     ${cfSet.size}`);
  console.log(`Does-test / may-not-be (no product-type): ${doesTestSet.size}`);

  console.log("\nReading brands-master.csv...");
  const raw = readFileSync(CSV_PATH, "utf8");
  const { header, rows } = parseCSV(raw);
  console.log(`  ${rows.length} rows loaded`);

  let fixed = 0;
  let removed = 0;
  const cleaned = [];

  for (const row of rows) {
    const brandKey = norm(row.brand_name || "");
    let peta = row.peta === "TRUE";
    const lb  = row.leaping_bunny === "TRUE";

    if (peta && doesTestSet.has(brandKey)) {
      // This brand is explicitly listed as does-test / may-not-be on PETA's site
      console.log(`  FIXING:   ${row.brand_name} (was peta=TRUE, found in does-test set)`);
      peta = false;
      row.peta = "FALSE";
      fixed++;
    }

    if (!peta && !lb) {
      // Nothing certifies it — drop from the list
      console.log(`  REMOVING: ${row.brand_name} (no certification after fix)`);
      removed++;
      continue;
    }

    cleaned.push(row);
  }

  console.log(`\nFixed:   ${fixed} rows (peta flipped to FALSE)`);
  console.log(`Removed: ${removed} rows (no longer certified)`);
  console.log(`Kept:    ${cleaned.length} rows`);

  writeFileSync(CSV_PATH, serializeCSV(header, cleaned), "utf8");
  console.log(`\nWrote cleaned brands-master.csv`);
  console.log("Now run: node scripts/build-brands-json.mjs");
}

main().catch(err => { console.error(err); process.exit(1); });
