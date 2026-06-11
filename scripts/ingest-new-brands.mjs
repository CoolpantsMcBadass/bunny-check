// ingest-new-brands.mjs
// Adds newly spotted Ulta brands to data/ulta-brands-researched.csv as
// unresearched rows (peta=FALSE, leaping_bunny=FALSE, peta_status=pending),
// ready for the verify pipeline.
//
// Input: one brand name per line — exactly what the extension popup's
// "Copy list" button produces — via a file argument or stdin:
//   node scripts/ingest-new-brands.mjs new-brands.txt
//   pbpaste | node scripts/ingest-new-brands.mjs
//
// Names already present in the CSV (by normalized brand name or slug) are
// skipped. After ingesting, run:
//   node scripts/verify-ulta-csv.mjs --apply
//   node scripts/verify-lb-names.mjs --apply
//   node scripts/build-ulta-brands-json.mjs

import { readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "../data/ulta-brands-researched.csv");
const DESKTOP_CSV = path.join(os.homedir(), "Desktop", "ulta-brands-researched.csv");

function norm(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/['’]/g, "").replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ").trim();
}
function slugify(s) {
  return norm(s).replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function quoteCell(v) { return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

const input = process.argv[2]
  ? readFileSync(process.argv[2], "utf8")
  : readFileSync(0, "utf8");

const names = [...new Set(
  input.split(/\r?\n/).map(l => l.trim()).filter(l => l.length >= 2 && l.length <= 60)
)];
if (names.length === 0) {
  console.error("No brand names on input. Paste the popup's copied list (one per line).");
  process.exit(1);
}

const csvText = readFileSync(CSV_PATH, "utf8");
const lines = csvText.split(/\r?\n/);
const existingNames = new Set();
const existingSlugs = new Set();
for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  // brand_name is the first cell; slug the second. Quoted names are rare but real.
  const m = line.match(/^"((?:[^"]|"")*)",([^,]*)/) || line.match(/^([^,]*),([^,]*)/);
  if (m) {
    existingNames.add(norm(m[1].replace(/""/g, '"')));
    existingSlugs.add(m[2].trim());
  }
}

const today = new Date().toISOString().slice(0, 10);
const added = [];
const skipped = [];
for (const name of names) {
  const slug = slugify(name);
  if (!slug || existingNames.has(norm(name)) || existingSlugs.has(slug)) {
    skipped.push(name);
    continue;
  }
  existingNames.add(norm(name));
  existingSlugs.add(slug);
  added.push([quoteCell(name), slug, "FALSE", "FALSE", "pending", "", "", "", "",
    quoteCell(`Auto-added from extension unknown-brand collector ${today}; needs parent research`)].join(","));
}

if (added.length) {
  const out = csvText.replace(/\n*$/, "\n") + added.join("\n") + "\n";
  writeFileSync(CSV_PATH, out, "utf8");
  writeFileSync(DESKTOP_CSV, out, "utf8");
}

console.log(`Added ${added.length} new rows, skipped ${skipped.length} already-known.`);
if (skipped.length) console.log("  skipped:", skipped.join(", "));
if (added.length) {
  console.log("\nNext steps:");
  console.log("  node scripts/verify-ulta-csv.mjs --apply   # PETA check");
  console.log("  node scripts/verify-lb-names.mjs --apply   # Leaping Bunny check");
  console.log("  (research parent companies for any newly certified rows)");
  console.log("  node scripts/build-ulta-brands-json.mjs    # rebuild brands.json");
}
