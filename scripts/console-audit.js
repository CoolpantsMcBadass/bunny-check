// BunnyCheck console audit — paste into DevTools console.
// Downloads results as bunny-results.txt automatically.
(function() {
  document.addEventListener("bunnycheck-audit-response", function handler(e) {
    document.removeEventListener("bunnycheck-audit-response", handler);
    const d = e.detail;
    if (d.error) { console.error("BunnyCheck:", d.error); return; }

    let out = "BunnyCheck Audit\n";
    out += "================\n";
    out += d.badges.length + " badges, " + d.misses.length + " unmatched\n\n";

    out += "--- BADGES ---\n";
    for (const b of d.badges) {
      const certs = [b.peta ? "PETA" : null, b.lb ? "LB" : null].filter(Boolean).join("+") || "??";
      out += "[" + b.tier + "] " + b.brand + " [" + certs + "]\n";
      out += "     via: \"" + b.via + "\"\n";
      out += "     img: \"" + b.img + "\"\n";
      out += "     card: \"" + (b.card || "(none)") + "\"\n\n";
    }

    out += "--- UNMATCHED ---\n";
    d.misses.forEach(m => out += "  " + m + "\n");

    // Download as file.
    const blob = new Blob([out], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bunny-results.txt";
    a.click();
    URL.revokeObjectURL(url);

    console.log("BunnyCheck: results downloaded as bunny-results.txt");
  });

  document.dispatchEvent(new Event("bunnycheck-audit-request"));
  console.log("BunnyCheck audit requested...");
})();
