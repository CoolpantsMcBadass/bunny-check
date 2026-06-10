// BunnyCheck smoke test — runs the real matcher.js + content.js against a
// synthetic Ulta-style grid with a stubbed chrome.storage API.
//
// Scenarios:
//   card1 — normal card with Text-brandName "Pacifica" (in DB) → should badge
//   card2 — card with no text yet (unrendered) → must NOT cross-match a
//           neighbor's brand (the v0.6.2 bug); must stay retry-able
//   card3 — card with brand "SomeTester" (not in DB) → no badge, marked "0"
//   card4 — category tile (img in <a> labeled "Nails") → must NOT badge even
//           though Nails Inc. is in the DB (generic-alias fix)
//   card5 — card with brand element "essence" (generic_name brand) → SHOULD
//           badge: tier-0 brand-element text may match generic-named brands
//   card6 — card text starting with "Essence" but no brand element → must NOT
//           badge: generic-named brands don't match arbitrary text
//   reparenting — img1's parent chain must be untouched (no wrapper span)
//   prune — removing img1 (framework re-render) must remove its badge host
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const PROJ = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import("playwright");
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pad = "lorem ipsum dolor sit amet ".repeat(60); // >1200 chars of grid-level text, like a real grid

// Flex row + small images so every card is inside the viewport — offscreen
// cards never trigger the IntersectionObserver and pass checks vacuously.
const html = `<!DOCTYPE html><html><body>
<div id="grid" style="display:flex;flex-wrap:wrap;gap:4px">
  <div class="pal-c-ProductCard" id="card1" style="width:160px">
    <div><div><img id="img1" src="${IMG}" width="150" height="150"></div></div>
    <div><span class="Text-brandName">Pacifica</span> <span>Glow Serum</span></div>
  </div>
  <div class="pal-c-ProductCard" id="card2" style="width:160px">
    <div><div><img id="img2" src="${IMG}" width="150" height="150"></div></div>
  </div>
  <div class="pal-c-ProductCard" id="card3" style="width:160px">
    <div><div><img id="img3" src="${IMG}" width="150" height="150"></div></div>
    <div><span class="Text-brandName">SomeTester</span> <span>Not certified product</span></div>
  </div>
  <div class="category-tile" id="card4" style="width:160px">
    <a href="/shop/nails"><div><img id="img4" src="${IMG}" width="150" height="150"></div><span>Nails</span></a>
  </div>
  <div class="pal-c-ProductCard" id="card5" style="width:160px">
    <div><div><img id="img5" src="${IMG}" width="150" height="150"></div></div>
    <div><span class="Text-brandName">essence</span> <span>Pure Nude Highlighter</span></div>
  </div>
  <div class="pal-c-ProductCard" id="card6" style="width:160px">
    <div><div><img id="img6" src="${IMG}" width="150" height="150"></div></div>
    <div><span>Essence of Beauty gift set</span></div>
  </div>
  <div id="pad" style="font-size:4px">${pad}</div>
</div>
</body></html>`;

const brands = {
  pacifica: { display_name: "Pacifica", ulta_slug: "pacifica", aliases: [], peta: true, leaping_bunny: true, parent_cf_bad: false, data_version: "2026-06-10" },
  "nails-inc": { display_name: "Nails Inc.", ulta_slug: "nails-inc", aliases: ["nails inc"], peta: true, leaping_bunny: false, parent_cf_bad: false, data_version: "2026-06-10" },
  essence: { display_name: "essence", ulta_slug: "essence", aliases: [], peta: true, leaping_bunny: false, parent_cf_bad: false, generic_name: true, data_version: "2026-06-10" },
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (msg) => console.log("[page]", msg.type(), msg.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));
await page.setContent(html);
await page.evaluate((db) => {
  window.chrome = { storage: { local: { get: (_key, cb) => cb({ bunnycheck_brands: db }) } } };
}, brands);
await page.addScriptTag({ path: PROJ + "/matcher.js" });
await page.addScriptTag({ path: PROJ + "/content.js" });
await page.waitForTimeout(800);

const r1 = await page.evaluate(() => {
  const img1 = document.getElementById("img1");
  const badge1 = document.querySelector("#card1 [data-bunnycheck-badge]");
  return {
    img1Done: img1.getAttribute("data-bunnycheck-done"),
    img1GreatGrandparent: img1.parentElement.parentElement.parentElement.id,
    card1Badge: !!badge1,
    badge1Label: badge1?.shadowRoot?.querySelector(".sr-only")?.textContent.trim() ?? null,
    img2Done: document.getElementById("img2").getAttribute("data-bunnycheck-done"),
    card2Badge: !!document.querySelector("#card2 [data-bunnycheck-badge]"),
    img3Done: document.getElementById("img3").getAttribute("data-bunnycheck-done"),
    card3Badge: !!document.querySelector("#card3 [data-bunnycheck-badge]"),
    card4Badge: !!document.querySelector("#card4 [data-bunnycheck-badge]"),
    img4Done: document.getElementById("img4").getAttribute("data-bunnycheck-done"),
    card5Badge: !!document.querySelector("#card5 [data-bunnycheck-badge]"),
    badge5Label: document.querySelector("#card5 [data-bunnycheck-badge]")?.shadowRoot?.querySelector(".sr-only")?.textContent.trim() ?? null,
    card6Badge: !!document.querySelector("#card6 [data-bunnycheck-badge]"),
    img6Done: document.getElementById("img6").getAttribute("data-bunnycheck-done"),
    wrapperSpansAroundImgs: [...document.querySelectorAll("span")].filter((s) => s.querySelector("img")).length,
  };
});

// Simulate a framework re-render detaching the badged image.
await page.evaluate(() => document.getElementById("img1").remove());
await page.waitForTimeout(700);
const r2 = await page.evaluate(() => ({
  card1BadgeAfterImgRemoved: !!document.querySelector("#card1 [data-bunnycheck-badge]"),
}));

await browser.close();

const results = { ...r1, ...r2 };
console.log(JSON.stringify(results, null, 2));

const checks = {
  "card1 badged": results.card1Badge === true && results.img1Done === "1",
  "card1 badge is Pacifica": (results.badge1Label ?? "").includes("Pacifica"),
  "img1 not reparented": results.img1GreatGrandparent === "card1",
  "card2 NOT cross-matched": results.card2Badge === false,
  "card2 still retry-able": results.img2Done === null,
  "card3 (non-CF) not badged": results.card3Badge === false && results.img3Done === "0",
  "category tile 'Nails' not badged": results.card4Badge === false && results.img4Done === "0",
  "generic brand badges via brand element": results.card5Badge === true && (results.badge5Label ?? "").includes("essence"),
  "generic word in plain text not matched": results.card6Badge === false && results.img6Done === "0",
  "no wrapper spans": results.wrapperSpansAroundImgs === 0,
  "badge pruned after re-render": results.card1BadgeAfterImgRemoved === false,
};

let pass = true;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) pass = false;
}
process.exit(pass ? 0 : 1);
