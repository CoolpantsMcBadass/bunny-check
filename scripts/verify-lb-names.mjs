// verify-lb-names.mjs
// Matches Ulta brands marked leaping_bunny=FALSE in data/ulta-brands-researched.csv
// against the (freshly scraped) Leaping Bunny list in data/lb-raw.txt.
//
// LB often lists brands under a corporate name ("Iredale Cosmetics, Inc." for
// Ulta's "jane iredale"), so in addition to exact/suffix/prefix name matches
// this reports *distinctive-token* overlaps for manual review: an Ulta brand
// and an LB entry sharing an uncommon token (rare within the LB list itself)
// are probably the same company under different names.
//
// Prints a TSV report; pass --apply to set leaping_bunny=TRUE for exact /
// suffix / prefix matches only. Token matches are never auto-applied —
// confirm them manually (and research the parent company) first.
//
// Run: node scripts/verify-lb-names.mjs [--apply]

import { readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "../data/ulta-brands-researched.csv");
const DESKTOP_CSV = path.join(os.homedir(), "Desktop", "ulta-brands-researched.csv");
const LB_PATH = path.join(__dirname, "../data/lb-raw.txt");
const APPLY = process.argv.includes("--apply");

// ─── CSV helpers (same dialect as verify-ulta-csv.mjs) ───────────────────────

function splitRow(line) {
  const cells = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === ",") { cells.push(cur); cur = ""; } else cur += ch; }
  }
  cells.push(cur); return cells;
}
function quoteCell(v) { return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const header = splitRow(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(l => {
    const c = splitRow(l); const o = {};
    header.forEach((h, j) => o[h] = c[j] ?? "");
    return o;
  });
  return { header, rows };
}

// ─── Name normalization (same rules as verify-ulta-csv.mjs) ──────────────────

const SUFFIX = /\s+(cosmetics?|beauty|skincare|skin care|haircare|hair care|fragrances?|parfums?|naturals?|organics?|professional|inc\.?|llc\.?|ltd\.?|co\.?)\s*$/i;
function norm(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/[®™©℗]/g, "")
    .replace(/['’]/g, "").replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
}
function stems(name) {
  const n = norm(name); const out = [n];
  const s = n.replace(SUFFIX, "").trim();
  if (s && s !== n) out.push(s);
  return out;
}
const GENERIC_TAIL = new Set([
  "the", "of", "and", "by", "skin", "care", "skincare", "makeup", "make",
  "up", "cosmetics", "cosmetic", "beauty", "hair", "haircare", "fragrance",
  "fragrances", "parfums", "professional", "collection", "company", "co",
  "inc", "llc", "ltd", "brands", "brand", "laboratories", "labs", "usa",
  "international",
]);
function matchQuality(ultaName, lbName) {
  const u = norm(ultaName), p = norm(lbName);
  if (u === p) return "exact";
  const us = stems(ultaName), ps = stems(lbName);
  if (us.some(a => ps.includes(a))) {
    const stem = us.find(a => ps.includes(a));
    return (stem.includes(" ") || stem.length >= 6) ? "suffix" : "loose";
  }
  if ((u.includes(" ") || u.length >= 6) && p.startsWith(u + " ")) {
    const tail = p.slice(u.length).trim().split(/\s+/);
    if (tail.every(t => GENERIC_TAIL.has(t))) return "prefix";
  }
  return "loose";
}

// ─── Distinctive-token index over the LB list ─────────────────────────────────

const STOP = new Set([...GENERIC_TAIL,
  "body", "bath", "soap", "natural", "naturals", "organic", "organics",
  "products", "personal", "home", "essentials", "group", "corporation",
  "corp", "industries", "world", "york", "paris", "london",
]);
function tokens(name) {
  return norm(name).split(/[\s-]+/).filter(t => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t));
}

const lbNames = readFileSync(LB_PATH, "utf8").split(/\r?\n/).filter(l => l.trim());

// token → LB names containing it; tokens appearing in many LB entries are
// too common to identify a company.
const tokenIndex = new Map();
for (const name of lbNames) {
  for (const t of new Set(tokens(name))) {
    if (!tokenIndex.has(t)) tokenIndex.set(t, []);
    tokenIndex.get(t).push(name);
  }
}
const MAX_TOKEN_FREQ = 2;

// ─── Main ─────────────────────────────────────────────────────────────────────

const { header, rows } = parseCSV(readFileSync(CSV_PATH, "utf8"));
const candidates = rows.filter(r => r.leaping_bunny !== "TRUE" && r.brand_name && r.ulta_slug);
console.log(`Matching ${candidates.length} leaping_bunny=FALSE rows against ${lbNames.length} live LB names...\n`);
console.log("ulta_slug\tlb_name\tmatch\tverdict");

const corrections = [];
for (const row of candidates) {
  // Pass 1: direct name match.
  const rank = { exact: 0, suffix: 1, prefix: 2, loose: 3 };
  let best = null;
  for (const lb of lbNames) {
    const q = matchQuality(row.brand_name, lb);
    if (q === "loose") continue;
    if (!best || rank[q] < rank[best.q]) best = { lb, q };
  }
  if (best) {
    console.log(`${row.ulta_slug}\t${best.lb}\t${best.q}\tSET lb=TRUE`);
    corrections.push(row);
    continue;
  }
  // Pass 2: distinctive-token overlap (corporate-name candidates, review-only).
  const seen = new Set();
  for (const t of new Set(tokens(row.brand_name))) {
    const holders = tokenIndex.get(t) ?? [];
    if (holders.length === 0 || holders.length > MAX_TOKEN_FREQ) continue;
    for (const lb of holders) {
      if (seen.has(lb)) continue;
      seen.add(lb);
      console.log(`${row.ulta_slug}\t${lb}\ttoken:${t}\tREVIEW (corporate name?)`);
    }
  }
}

console.log(`\n${corrections.length} direct matches.`);

if (APPLY && corrections.length) {
  for (const row of corrections) row.leaping_bunny = "TRUE";
  const out = [header.join(",")]
    .concat(rows.map(r => header.map(h => quoteCell(r[h] ?? "")).join(",")))
    .join("\n") + "\n";
  writeFileSync(CSV_PATH, out, "utf8");
  writeFileSync(DESKTOP_CSV, out, "utf8");
  console.log(`Applied to ${CSV_PATH} (+ Desktop copy). Now run: node scripts/build-ulta-brands-json.mjs`);
} else if (corrections.length) {
  console.log("Dry run — re-run with --apply to write the CSV.");
}
