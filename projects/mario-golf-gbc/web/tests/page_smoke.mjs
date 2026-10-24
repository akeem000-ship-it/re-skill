// Smoke test of web/index.html in headless Chromium: load the page (the ROM from rom/ through a local server),
// press START / A to get past the title into the menus, then report frames run, fps, page errors, whether the
// battery save reached localStorage, and save a screenshot. Then reload the page and check the save comes back.
// usage: (python3 -m http.server 8765 from the project folder) node web/tests/page_smoke.mjs [OUT.png] [seconds]
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [out = "out/page_smoke.png", secs = "20"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:8765/web/index.html");
const press = async (key, ms = 150) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
for (let t = 0; t < +secs; t++) {
  await page.waitForTimeout(1000);
  if (t === 12) await press("Enter"); else if (t === 15) await press("Enter"); else if (t === 18) await press("z");
}
const res = await page.evaluate(() => ({
  frames: window.__mg?.gb?.frames, status: document.getElementById("status").textContent,
  save: Object.keys(localStorage).filter(k => k.startsWith("mg-sram-")).map(k => [k, localStorage.getItem(k).length]),
}));
await page.screenshot({ path: out });
await page.reload(); await page.waitForTimeout(2000);
const after = await page.evaluate(() => document.getElementById("save").textContent);
console.log(JSON.stringify({ ...res, afterReload: after, errors: errors.slice(0, 5) }));
await browser.close();
process.exit(errors.length || !res.frames ? 1 : 0);
