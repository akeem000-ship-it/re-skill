// Smoke test of web/full.html in headless Chromium: load the page (the ROM from rom/ through the local server),
// run it a few seconds, press START a few times, and report the status line, fps and a screenshot.
// usage: (python3 -m http.server 8765 from the project root) node web/tests/page_smoke.mjs "full.html?port" OUT.png [seconds]
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [page_ = "full.html", out = "out/page_smoke.png", secs = "8"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`http://localhost:8765/web/${page_}`);
for (let t = 0; t < +secs; t++) {
  await page.waitForTimeout(1000);
  if (t % 3 === 2) { await page.keyboard.down("Enter"); await page.waitForTimeout(150); await page.keyboard.up("Enter"); }
}
const status = await page.evaluate(() => [document.getElementById("romstatus")?.textContent, document.getElementById("fps")?.textContent, window.__gb?.gb?.frames]);
await page.screenshot({ path: out });
console.log(JSON.stringify({ status, errors: errors.slice(0, 5) }));
await browser.close();
