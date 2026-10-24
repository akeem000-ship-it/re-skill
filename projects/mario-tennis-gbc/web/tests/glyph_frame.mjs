// Screenshot the web port at the first point-score display (state "dead" with the glyph strip) for a
// visual check of the bank-09 glyph strip. usage: node web/tests/glyph_frame.mjs OUT.png [--url ...]
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0] || "out/glyph_frame.png", url = opt("--url", "http://localhost:8765/web/index.html");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const page = await browser.newPage();
await page.goto(url);
await page.waitForFunction(() => window.__mt, null, { timeout: 30000 });
await page.evaluate(() => { window.__mt.pause(); window.__mt.start(); window.__mt.match.players[0].cpu = true; });
let shown = null;
for (let i = 0; i < 400 && !shown; i++) {
  shown = await page.evaluate(() => {
    for (let f = 0; f < 60; f++) {
      window.__mt.step();
      const m = window.__mt.match;
      if (m.state === "dead" && m.pointGlyphs && m.deadT === 40) return { glyphs: m.pointGlyphs, score: m.scoreText(), over: m.over };
      if (m.over) return { over: true };
    }
    return null;
  });
}
console.log(JSON.stringify(shown));
await page.locator("#screen").screenshot({ path: out });
await browser.close();
