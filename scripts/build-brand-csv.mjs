// build-brand-csv.mjs
// Merges peta-raw.txt and lb-raw.txt into a single CSV with:
//   brand_name, peta, leaping_bunny, parent_company, parent_status, notes
//
// Run with: node scripts/build-brand-csv.mjs

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETA_PATH  = path.join(__dirname, "../data/peta-raw.txt");
const LB_PATH    = path.join(__dirname, "../data/lb-raw.txt");
const OUT_PATH   = path.join(__dirname, "../data/brands-master.csv");

// ─── Bad parent companies ─────────────────────────────────────────────────────
// Key: normalized parent name fragment (lowercase, stripped)
// Value: { status, notes }
// "bad" = parent sells cosmetics in mainland China (requires animal testing by law)
// "gray" = contested / only some divisions sell in China
// Entries are matched via substring so "estee lauder" matches "The Estée Lauder Companies"

const BAD_PARENTS = {
  // L'Oréal Group — sells cosmetics in China
  "l'oreal":        { status: "bad", notes: "L'Oréal sells in China" },
  "loreal":         { status: "bad", notes: "L'Oréal sells in China" },
  "l oreal":        { status: "bad", notes: "L'Oréal sells in China" },

  // Estée Lauder Companies — sells in China
  "estee lauder":   { status: "bad", notes: "Estée Lauder sells in China" },
  "estée lauder":   { status: "bad", notes: "Estée Lauder sells in China" },

  // Procter & Gamble — sells cosmetics in China (SK-II, Olay, etc.)
  "procter & gamble":  { status: "bad", notes: "P&G sells in China" },
  "procter and gamble":{ status: "bad", notes: "P&G sells in China" },
  "p&g":               { status: "bad", notes: "P&G sells in China" },

  // Unilever — sells in China (Dove, TRESemmé, etc.)
  "unilever":       { status: "bad", notes: "Unilever sells in China" },

  // Shiseido — sells in China
  "shiseido":       { status: "bad", notes: "Shiseido sells in China" },

  // LVMH — sells in China (Dior, Givenchy, Guerlain)
  "lvmh":           { status: "bad", notes: "LVMH sells in China" },

  // Coty — sells in China
  "coty":           { status: "bad", notes: "Coty sells in China" },

  // Revlon — sells in China
  "revlon":         { status: "bad", notes: "Revlon sells in China" },

  // Henkel — sells in China (Schwarzkopf)
  "henkel":         { status: "bad", notes: "Henkel sells in China" },

  // Kao Corporation — sells in China
  "kao":            { status: "bad", notes: "Kao Corp sells in China" },

  // Beiersdorf — sells in China (Nivea, Eucerin)
  "beiersdorf":     { status: "bad", notes: "Beiersdorf sells in China" },

  // Wella / KKR — debatable, was P&G, now sold
  "wella":          { status: "gray", notes: "Formerly P&G; China status uncertain post-sale" },

  // Clorox — primarily household products, Burt's Bees CF status often upheld
  "clorox":         { status: "gray", notes: "Clorox parent; Burt's Bees CF status debated" },

  // Church & Dwight — sells in China (OxiClean, Arm & Hammer)
  "church & dwight":  { status: "gray", notes: "Church & Dwight sells household products in China; beauty division unclear" },
  "church and dwight":{ status: "gray", notes: "Church & Dwight sells household products in China; beauty division unclear" },

  // Edgewell — Schick, Wilkinson Sword; CF status unclear
  "edgewell":       { status: "gray", notes: "Edgewell China CF status unclear" },
};

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/[\u2018\u2019\u02BC]/g, "'")  // curly/modifier apostrophes → straight
    .replace(/[\u201C\u201D]/g, '"')          // curly double quotes → straight
    .replace(/,?\s+(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|gmbh|plc)$/i, "") // strip legal suffixes
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Parse PETA list ──────────────────────────────────────────────────────────
// Lines like:
//   "Burt's Bees (Clorox)"          → name="Burt's Bees",  parent="Clorox"
//   "NYX Professional Makeup (L'Oreal)" → name="NYX...", parent="L'Oreal"
//   "100% Pure"                      → name="100% Pure",   parent=""
// Some entries have nested parens, e.g. "Foo (Bar (Baz))" — take last paren group.

function parsePetaLine(line) {
  line = line.trim();
  if (!line) return null;

  // Match trailing (Parent) — greedy last paren group
  const m = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    return { display: m[1].trim(), parent: m[2].trim() };
  }
  return { display: line, parent: "" };
}

// ─── Parent status lookup ─────────────────────────────────────────────────────

function lookupParent(parent) {
  if (!parent) return { status: "unknown", notes: "" };
  const norm = normalize(parent);
  for (const [key, val] of Object.entries(BAD_PARENTS)) {
    if (norm.includes(key)) return val;
  }
  return { status: "ok", notes: "" };
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function csvCell(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(",");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // Load and parse PETA list
  const petaLines = readFileSync(PETA_PATH, "utf8").split("\n").filter(Boolean);
  const petaEntries = petaLines.map(parsePetaLine).filter(Boolean);
  console.log(`PETA entries: ${petaEntries.length}`);

  // Load LB list
  const lbNames = new Set(
    readFileSync(LB_PATH, "utf8").split("\n")
      .map(l => l.trim()).filter(Boolean)
      .map(normalize)
  );
  console.log(`LB entries: ${lbNames.size}`);

  // Build merged brand map, keyed by normalized brand name (without parent)
  // Multiple PETA entries can normalize to the same key — keep first, note dupes
  const brands = new Map(); // normKey → row object

  for (const { display, parent } of petaEntries) {
    const key = normalize(display);
    if (brands.has(key)) continue; // duplicate PETA entry

    const inLB = lbNames.has(key);
    const parentInfo = lookupParent(parent);

    brands.set(key, {
      brand_name: display,
      peta: true,
      leaping_bunny: inLB,
      parent_company: parent,
      parent_status: parentInfo.status,
      notes: parentInfo.notes,
    });
  }

  // Add LB-only brands (not in PETA)
  const lbRaw = readFileSync(LB_PATH, "utf8").split("\n").map(l => l.trim()).filter(Boolean);
  for (const lbName of lbRaw) {
    const key = normalize(lbName);
    if (!brands.has(key)) {
      brands.set(key, {
        brand_name: lbName,
        peta: false,
        leaping_bunny: true,
        parent_company: "",
        parent_status: "unknown",
        notes: "",
      });
    } else {
      // Mark as also LB (may have been missed if norm keys differ slightly)
      brands.get(key).leaping_bunny = true;
    }
  }

  // Sort by brand name
  const rows = [...brands.values()].sort((a, b) =>
    a.brand_name.toLowerCase().localeCompare(b.brand_name.toLowerCase())
  );

  // Stats
  const petaCount = rows.filter(r => r.peta).length;
  const lbCount   = rows.filter(r => r.leaping_bunny).length;
  const bothCount = rows.filter(r => r.peta && r.leaping_bunny).length;
  const badCount  = rows.filter(r => r.parent_status === "bad").length;
  const grayCount = rows.filter(r => r.parent_status === "gray").length;
  console.log(`\nMerged total: ${rows.length} unique brands`);
  console.log(`  PETA only:      ${petaCount - bothCount}`);
  console.log(`  LB only:        ${lbCount - bothCount}`);
  console.log(`  Both:           ${bothCount}`);
  console.log(`  Bad parent:     ${badCount}`);
  console.log(`  Gray parent:    ${grayCount}`);
  console.log(`  OK/Unknown:     ${rows.length - badCount - grayCount}`);

  // Write CSV
  const header = csvRow(["brand_name","peta","leaping_bunny","parent_company","parent_status","notes"]);
  const body = rows.map(r => csvRow([
    r.brand_name,
    r.peta ? "TRUE" : "FALSE",
    r.leaping_bunny ? "TRUE" : "FALSE",
    r.parent_company,
    r.parent_status,
    r.notes,
  ]));
  const csv = [header, ...body].join("\n") + "\n";

  writeFileSync(OUT_PATH, csv);
  console.log(`\nWritten to: ${OUT_PATH}`);
}

main();
