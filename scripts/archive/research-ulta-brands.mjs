// research-ulta-brands.mjs
// ARCHIVED (2026-06-12): original bulk research pass from 2026-06-07 — its
// output (after parent research and Sephora expansion) became
// data/retailer-brands-researched.csv. Superseded by verify-ulta-csv.mjs /
// verify-lb-names.mjs, which use better matching (squash tier, body-class
// status, both LB lists). Kept for provenance.
//
// For each brand in ulta-brands.csv:
//   - Checks PETA's site directly (company page H1)
//   - Checks Leaping Bunny's current brand list
// Outputs ulta-brands-researched.csv with peta + leaping_bunny columns.
// Parent company research is done separately.
//
// Run: node scripts/archive/research-ulta-brands.mjs

import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_CSV        = path.join(__dirname, "../../data/ulta-brands.csv");
const OUT_CSV       = path.join(__dirname, "../../data/ulta-brands-researched.csv");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const delay = ms => new Promise(r => setTimeout(r, ms));

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const header = splitRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitRow(lines[i]);
    const obj = {};
    header.forEach((h, j) => { obj[h] = (cells[j] ?? "").trim(); });
    rows.push(obj);
  }
  return { header, rows };
}

function splitRow(line) {
  const cells = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { cells.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function q(v) {
  v = String(v ?? "");
  return (v.includes(",") || v.includes('"') || v.includes("\n"))
    ? '"' + v.replace(/"/g, '""') + '"'
    : v;
}

function writeCSV(filePath, header, rows) {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(header.map(h => q(row[h] ?? "")).join(","));
  writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

// ─── Name normalization ───────────────────────────────────────────────────────

function norm(name) {
  return name
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/[®™©℗]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// ─── Leaping Bunny: fetch full brand list from site ───────────────────────────

async function fetchLBBrands() {
  const brands = new Set();
  let page = 0;
  while (true) {
    process.stdout.write(`  LB page ${page}...`);
    const url = `https://www.leapingbunny.org/guide/brands?page=${page}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const html = await res.text();
    const matches = [...html.matchAll(/<a href="\/brand\/([^"]+)"[^>]*>([^<]+)<\/a>/g)];
    if (!matches.length) { console.log(" (empty, done)"); break; }
    for (const m of matches) {
      const raw = m[2].replace(/&amp;/g,"&").replace(/&#039;/g,"'").replace(/&quot;/g,'"').trim();
      brands.add(norm(raw));
    }
    console.log(` ${matches.length} brands`);
    page++;
    await delay(200);
  }
  return brands;
}

// ─── PETA: check a brand's page ───────────────────────────────────────────────
// Returns: "cf" | "not_cf" | "may_not_be" | "not_found"

async function checkPeta(slug, brandName) {
  // Strategy 1: try Ulta slug directly as PETA slug
  const result = await fetchPetaPage(slug);
  if (result !== "not_found") return result;

  // Strategy 2: try PETA's search API to find the right slug
  const searchSlug = await petaSearchSlug(brandName);
  if (!searchSlug) return "not_found";
  return await fetchPetaPage(searchSlug);
}

async function fetchPetaPage(slug) {
  const url = `https://crueltyfree.peta.org/company/${slug}/`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 404) return "not_found";
    if (!res.ok) return "not_found";
    const html = await res.text();
    const h1m = html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/);
    const h1 = h1m ? h1m[1].toLowerCase() : "";
    if (h1.includes("is cruelty-free")) return "cf";
    if (h1.includes("is not cruelty-free") || h1.includes("not cruelty-free")) return "not_cf";
    if (h1.includes("may not be")) return "may_not_be";
    // Page exists but couldn't parse status — assume CF (it's on the CF site)
    return "cf_unknown";
  } catch {
    return "not_found";
  }
}

async function petaSearchSlug(brandName) {
  const encoded = encodeURIComponent(brandName);
  const url = `https://crueltyfree.peta.org/wp-json/wp/v2/company?search=${encoded}&per_page=5&_fields=id,slug,title`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    // Find best match: exact normalized title match first, then first result
    const normBrand = norm(brandName);
    const exact = results.find(r => norm(r.title?.rendered || "") === normBrand);
    return (exact || results[0]).slug;
  } catch {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load input
  const { rows: inputRows } = parseCSV(readFileSync(IN_CSV, "utf8"));
  console.log(`Loaded ${inputRows.length} brands from ulta-brands.csv`);

  // Load existing output if resuming
  let existing = {};
  if (existsSync(OUT_CSV)) {
    const { rows: outRows } = parseCSV(readFileSync(OUT_CSV, "utf8"));
    for (const r of outRows) existing[r.ulta_slug] = r;
    console.log(`Resuming — ${outRows.length} brands already researched`);
  }

  // Fetch current LB brand list
  console.log("\nFetching Leaping Bunny brand list from leapingbunny.org...");
  const lbBrands = await fetchLBBrands();
  console.log(`Total LB brands: ${lbBrands.size}`);

  // Output header
  const outHeader = ["brand_name","ulta_slug","peta","leaping_bunny","peta_status","parent_company","parent_cf","top_parent","top_parent_cf","notes"];

  const results = [];
  let done = 0, skipped = 0;

  console.log("\nResearching brands...");

  for (const row of inputRows) {
    const { brand_name, ulta_slug } = row;

    // Skip if already done
    if (existing[ulta_slug]) {
      results.push(existing[ulta_slug]);
      skipped++;
      continue;
    }

    process.stdout.write(`[${done + skipped + 1}/${inputRows.length}] ${brand_name}... `);

    // LB check (instant — local set)
    const normName = norm(brand_name);
    const lb = lbBrands.has(normName);

    // PETA check
    await delay(250);
    const petaStatus = await checkPeta(ulta_slug, brand_name);
    const peta = petaStatus === "cf" || petaStatus === "cf_unknown";

    console.log(`PETA=${petaStatus} LB=${lb}`);

    results.push({
      brand_name,
      ulta_slug,
      peta:          peta ? "TRUE" : (petaStatus === "not_found" ? "FALSE" : "FALSE"),
      leaping_bunny: lb ? "TRUE" : "FALSE",
      peta_status:   petaStatus,
      parent_company: "",
      parent_cf:      "",
      top_parent:     "",
      top_parent_cf:  "",
      notes:          "",
    });

    done++;

    // Save progress every 25 brands
    if (done % 25 === 0) {
      writeCSV(OUT_CSV, outHeader, results);
      console.log(`  → saved progress (${done} new + ${skipped} skipped)`);
    }
  }

  writeCSV(OUT_CSV, outHeader, results);
  console.log(`\nDone. ${done} researched, ${skipped} skipped.`);
  console.log(`Output: ${OUT_CSV}`);
}

main().catch(err => { console.error(err); process.exit(1); });
