// scrape-cfi-lb-names.mjs
// Scrapes Cruelty Free International's Leaping Bunny approved-brands
// directory into data/cfi-lb-raw.txt (one display name per line, same format
// as data/lb-raw.txt).
//
// WHY A SECOND LB SOURCE: two organizations license the Leaping Bunny mark —
// CCIC (leapingbunny.org, North America; the source of lb-raw.txt) and CFI
// (international). UK/EU brands like REFY are CFI-approved and absent from
// the CCIC list entirely (discovered v0.9.3).
//
// The directory is plain server-rendered HTML at
//   /approved-brands/?_page=N&num=20&sort=post_title
// (num is capped at 20 server-side). Each brand appears as a link to
// /approved-brands/listing/<slug>/ carrying title="Brand Name". CFI's
// fancier Algolia search exists but its credentials aren't in the page;
// the pagination is the reliable path.
//
// Run: node scripts/scrape-cfi-lb-names.mjs

import { writeFileSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "../data/cfi-lb-raw.txt");
const BASE = "https://www.crueltyfreeinternational.org/approved-brands/";
// NOTE: a full Chrome UA string gets 403'd by CFI's firewall (it expects
// matching client-hint headers); this truncated UA passes.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
}

const byName = new Map(); // name → listing slug
let emptyPages = 0;

for (let page = 1; page <= 60; page++) {
  const url = `${BASE}?_page=${page}&num=20&sort=post_title`;
  // Node fetch gets 403'd by CFI's firewall; curl with a browser UA passes.
  let html;
  try {
    html = execFileSync("curl", ["-s", "-L", "--fail", "-A", UA, url],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).replace(/\n/g, " ");
  } catch {
    console.error(`Page ${page}: curl failed — stopping.`);
    break;
  }
  const re = /href="https:\/\/www\.crueltyfreeinternational\.org\/approved-brands\/listing\/([a-z0-9-]+)\/"[^>]*\btitle="([^"]+)"/g;
  let m, added = 0;
  while ((m = re.exec(html))) {
    const name = decodeEntities(m[2]).replace(/\s+/g, " ").trim();
    if (name.length < 1 || name.length > 80) continue;
    if (!byName.has(name)) { byName.set(name, m[1]); added++; }
  }
  process.stdout.write(`Page ${page}: +${added} (total ${byName.size})\n`);
  if (added === 0 && ++emptyPages >= 2) break; // two consecutive no-new pages = past the end
  if (added > 0) emptyPages = 0;
  await new Promise(r => setTimeout(r, 500));
}

if (byName.size < 300) {
  console.error(`Only ${byName.size} brands collected — page structure changed or blocked. Aborting without writing.`);
  process.exit(2);
}

const names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
writeFileSync(OUT_PATH, names.join("\n") + "\n", "utf8");
console.log(`\nWrote ${names.length} CFI Leaping Bunny brands → ${OUT_PATH}`);
console.log(`Listing URLs: https://www.crueltyfreeinternational.org/approved-brands/listing/<slug>/`);
console.log(`Next: node scripts/verify-lb-names.mjs   (now sweeps CCIC + CFI lists)`);
