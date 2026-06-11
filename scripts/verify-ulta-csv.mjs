// verify-ulta-csv.mjs
// Live-verifies PETA certification for Ulta brands marked peta=FALSE in
// ~/Desktop/ulta-brands-researched.csv whose names appear (under
// normalization) in PETA's company list.
//
// Ground truth = the company page H1 on crueltyfree.peta.org:
//   "X is cruelty-free"      → certified (peta should be TRUE)
//   "X may not be cruelty-free" / "X does test" → not certified
//
// The old research scraper guessed page slugs from Ulta names and recorded
// not_found when PETA registers a different corporate name (e.g. Ulta "Tarte"
// vs PETA "Tarte Cosmetics (Kose)" at slug tarte-cosmetics-kose).
//
// Prints a TSV report; pass --apply to write corrections back to the CSV
// (only rows whose H1 says "is cruelty-free" AND whose name match is exact
// or a single-suffix variant; everything else is report-only).
//
// Run: node scripts/verify-ulta-csv.mjs [--apply]

import { readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "../data/ulta-brands-researched.csv");
const DESKTOP_CSV = path.join(os.homedir(), "Desktop", "ulta-brands-researched.csv");
const API = "https://crueltyfree.peta.org/wp-json/wp/v2/company";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const APPLY = process.argv.includes("--apply");
// --recheck flips the sweep: re-verify rows already marked peta=TRUE and
// report any whose PETA page no longer says "is cruelty-free" (delistings,
// acquisitions). Always report-only — removals are applied by hand.
const RECHECK = process.argv.includes("--recheck");

// Brands that are themselves a company known to test (or to own testing
// operations) — never auto-apply even if PETA's H1 claims cruelty-free
// (the Estée Lauder lesson, v0.6.2).
const SELF_PARENT_DENYLIST = new Set([
  "estee-lauder", "shiseido", "revlon", "wella", "clairol",
]);

// ─── CSV helpers ──────────────────────────────────────────────────────────────

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

// ─── Name normalization ──────────────────────────────────────────────────────

const SUFFIX = /\s+(cosmetics?|beauty|skincare|skin care|haircare|hair care|fragrances?|parfums?|naturals?|organics?|professional|inc\.?|llc\.?|ltd\.?|co\.?)\s*$/i;
const ENTITIES = { "&amp;": "&", "&ndash;": "–", "&mdash;": "—", "&nbsp;": " ", "&quot;": '"', "&#039;": "'", "&apos;": "'" };
function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&\w+;/g, m => ENTITIES[m] ?? " ");
}
function norm(s) {
  return decodeEntities(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/[®™©℗]/g, "")
    .replace(/['’]/g, "").replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
}
function stems(name) {
  const n = norm(name); const out = [n];
  const s = n.replace(SUFFIX, "").trim();
  if (s && s !== n) out.push(s);
  return out;
}
// exact = identical normalized names; suffix = equal after stripping ONE
// category/legal suffix from one side; prefix = PETA title is the Ulta name
// followed by a tail made entirely of generic category/legal words
// (e.g. "jane iredale – THE SKIN CARE MAKEUP"). Anything else is "loose"
// (report-only).
const GENERIC_TAIL = new Set([
  "the", "of", "and", "by", "skin", "care", "skincare", "makeup", "make",
  "up", "cosmetics", "cosmetic", "beauty", "hair", "haircare", "fragrance",
  "fragrances", "parfums", "professional", "collection", "company", "co",
  "inc", "llc", "ltd", "brands", "brand", "laboratories", "labs", "usa",
  "international",
]);
function matchQuality(ultaName, petaTitle) {
  const u = norm(ultaName), p = norm(petaTitle);
  if (u === p) return "exact";
  const us = stems(ultaName), ps = stems(petaTitle);
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

// ─── PETA lookups ─────────────────────────────────────────────────────────────

async function petaSearch(name) {
  const url = `${API}?search=${encodeURIComponent(name)}&per_page=10&_fields=slug,title,link`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  return res.json();
}

async function pageH1Status(link) {
  const res = await fetch(link, { headers: { "User-Agent": UA } });
  if (!res.ok) return `http_${res.status}`;
  const html = await res.text();
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (!m) return "no_h1";
  const h1 = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (/may not be cruelty-free/.test(h1)) return "may_not_be";
  if (/is not cruelty-free|does test/.test(h1)) return "not_cf";
  if (/is cruelty-free/.test(h1)) return "cf";
  return "h1_unparsed:" + h1.slice(0, 60);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const { header, rows } = parseCSV(readFileSync(CSV_PATH, "utf8"));
const candidates = rows.filter(r =>
  (RECHECK ? r.peta === "TRUE" : r.peta !== "TRUE") && r.brand_name && r.ulta_slug);
console.log(`Checking ${candidates.length} peta=${RECHECK ? "TRUE (recheck)" : "FALSE"} rows against PETA live...\n`);
console.log("ulta_slug\tpeta_title\tpeta_slug\tmatch\th1_status\tverdict");

const corrections = [];
for (const row of candidates) {
  const hits = await petaSearch(row.brand_name);
  await new Promise(r => setTimeout(r, 200));
  if (!hits.length) {
    if (RECHECK) console.log(`${row.ulta_slug}\t-\t-\t-\tno_api_hits\tREVIEW (vanished from PETA search?)`);
    continue;
  }

  // Best hit: highest match quality against the Ulta name.
  const rank = { exact: 0, suffix: 1, prefix: 2, loose: 3 };
  const scored = hits
    .map(h => ({ ...h, title: decodeEntities(h.title?.rendered ?? "") }))
    .map(h => ({ ...h, q: matchQuality(row.brand_name, h.title) }))
    .sort((a, b) => rank[a.q] - rank[b.q]);
  const best = scored[0];
  if (best.q === "loose") {
    // Different company in all likelihood — report for manual review, no fetch.
    console.log(`${row.ulta_slug}\t${best.title}\t${best.slug}\tloose\t-\tREVIEW`);
    continue;
  }

  const status = await pageH1Status(best.link);
  await new Promise(r => setTimeout(r, 200));

  let verdict = "no_change";
  if (RECHECK) {
    // Report-only: surface TRUE rows whose live status is no longer "cf".
    if (status !== "cf") verdict = "REVIEW (was TRUE, live says " + status + ")";
    else continue; // still certified — don't clutter the report
  } else if (status === "cf") {
    verdict = SELF_PARENT_DENYLIST.has(row.ulta_slug) ? "DENYLISTED (review manually)" : "SET peta=TRUE";
    if (!SELF_PARENT_DENYLIST.has(row.ulta_slug)) corrections.push({ row, petaTitle: best.title });
  }
  console.log(`${row.ulta_slug}\t${best.title}\t${best.slug}\t${best.q}\t${status}\t${verdict}`);
}

console.log(`\n${corrections.length} rows verified cruelty-free on PETA's live site.`);

if (APPLY && corrections.length) {
  for (const { row } of corrections) {
    row.peta = "TRUE";
    row.peta_status = "cf";
  }
  const out = [header.join(",")]
    .concat(rows.map(r => header.map(h => quoteCell(r[h] ?? "")).join(",")))
    .join("\n") + "\n";
  writeFileSync(CSV_PATH, out, "utf8");
  writeFileSync(DESKTOP_CSV, out, "utf8");
  console.log(`Applied to ${CSV_PATH} (+ Desktop copy). Now run: node scripts/build-ulta-brands-json.mjs`);
} else if (corrections.length) {
  console.log("Dry run — re-run with --apply to write the CSV.");
}
