// monthly-maintenance.mjs
// One-shot data-health run, designed to be executed monthly (manually or via
// launchd — see scripts/com.bunnycheck.maintenance.plist):
//
//   1. Re-scrape Leaping Bunny's live list (scrape-lb-names.mjs)
//   2. PETA sweep of peta=FALSE rows        — newly certified brands
//   3. LB sweep of lb=FALSE rows            — newly certified brands
//   4. PETA recheck of peta=TRUE rows       — possible delistings
//   5. LB recheck of lb=TRUE rows           — possible delistings
//   6. Scrape Ulta's brand directory        — brands Ulta added/dropped
//      (opens a visible Chromium window briefly; Akamai blocks headless)
//
// Everything is REPORT-ONLY: nothing is applied to the CSV. The report lands
// in reports/maintenance-YYYY-MM-DD.md and a macOS notification summarizes
// the counts. Review the report, then apply changes with the individual
// scripts' --apply flags (and research parent companies for new brands).
//
// Run: node scripts/monthly-maintenance.mjs

import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const today = new Date().toISOString().slice(0, 10);
const REPORT_DIR = path.join(ROOT, "reports");
const REPORT_PATH = path.join(REPORT_DIR, `maintenance-${today}.md`);

function run(label, script, args = []) {
  process.stderr.write(`\n=== ${label} ===\n`);
  try {
    const out = execFileSync("node", [path.join(__dirname, script), ...args], {
      cwd: ROOT, encoding: "utf8", timeout: 30 * 60 * 1000,
    });
    process.stderr.write(out.split("\n").slice(-3).join("\n") + "\n");
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: (err.stdout || "") + "\nERROR: " + (err.message || "") };
  }
}

const sections = [];
const counts = {};

const lb = run("Refresh Leaping Bunny list", "scrape-lb-names.mjs");
sections.push(["Leaping Bunny list refresh", lb]);

const petaNew = run("PETA sweep (new certifications)", "verify-ulta-csv.mjs");
counts.petaNew = (petaNew.out.match(/SET peta=TRUE/g) || []).length;
sections.push(["PETA sweep — new certifications", petaNew]);

const lbNew = run("LB sweep (new certifications)", "verify-lb-names.mjs");
counts.lbNew = (lbNew.out.match(/SET lb=TRUE/g) || []).length;
counts.lbReview = (lbNew.out.match(/REVIEW \(corporate name\?\)/g) || []).length;
sections.push(["Leaping Bunny sweep — new certifications", lbNew]);

const petaRe = run("PETA recheck (delistings)", "verify-ulta-csv.mjs", ["--recheck"]);
counts.petaDelist = (petaRe.out.match(/REVIEW \(/g) || []).length;
sections.push(["PETA recheck — possible delistings", petaRe]);

const lbRe = run("LB recheck (delistings)", "verify-lb-names.mjs", ["--recheck"]);
counts.lbDelist = (lbRe.out.match(/REVIEW \(/g) || []).length;
sections.push(["Leaping Bunny recheck — possible delistings", lbRe]);

const ulta = run("Ulta brand directory diff", "scrape-ulta-brand-directory.mjs");
counts.ultaNew = (ulta.out.match(/^ {2}\+ /gm) || []).length;
sections.push(["Ulta brand directory diff", ulta]);

// ─── Report ───────────────────────────────────────────────────────────────────

mkdirSync(REPORT_DIR, { recursive: true });
const summary =
  `New PETA certs: ${counts.petaNew} | New LB certs: ${counts.lbNew} ` +
  `(+${counts.lbReview} corporate-name reviews) | ` +
  `PETA delist reviews: ${counts.petaDelist} | LB delist reviews: ${counts.lbDelist} | ` +
  `New Ulta brands: ${counts.ultaNew}`;

let md = `# BunnyCheck maintenance — ${today}\n\n${summary}\n\n` +
  `Nothing has been applied. To act on findings:\n` +
  `- new certs: \`node scripts/verify-ulta-csv.mjs --apply\` / \`node scripts/verify-lb-names.mjs --apply\`\n` +
  `- corporate-name reviews and delistings: verify identity manually, edit the CSV\n` +
  `- new Ulta brands: \`node scripts/ingest-new-brands.mjs\`, then the verify scripts\n` +
  `- then \`node scripts/build-ulta-brands-json.mjs\`, bump manifest, update changelog, push\n\n`;
for (const [title, res] of sections) {
  md += `## ${title}${res.ok ? "" : " (FAILED)"}\n\n\`\`\`\n${res.out.trim()}\n\`\`\`\n\n`;
}
writeFileSync(REPORT_PATH, md, "utf8");
console.log(`\nReport written: ${REPORT_PATH}`);
console.log(summary);

// macOS notification (best-effort).
try {
  execFileSync("osascript", ["-e",
    `display notification ${JSON.stringify(summary)} with title "BunnyCheck monthly maintenance"`]);
} catch (_) {}
