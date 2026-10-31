// The Android app's flow in headless Chromium: the page served as the app serves it (/assets/web/, the ROM at
// /assets/rom/mario_golf.gbc only once the app has kept one), a phone in landscape with touch, the app's user agent
// and a stand-in for its bridge (window.MGolfApp). First launch: no ROM -> the picker shows; choosing the ROM file
// starts the game and hands the ROM to the app. Second launch: the kept ROM is served and the game starts at once.
// The touch pad's A / START buttons drive the menus. Screenshots: out/app_first.png, out/app_second.png.
// usage: node web/tests/app_flow.mjs
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
let kept = null;                                           // the ROM the "app" stored
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/assets/rom/mario_golf.gbc") { if (kept) { res.writeHead(200); res.end(kept); } else { res.writeHead(404); res.end(); } return; }
  if (u.startsWith("/assets/web/")) {
    const f = path.join(root, "web", u.slice("/assets/web/".length));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f)); return; }
  }
  res.writeHead(404); res.end();
}).listen(8766);
const browser = await chromium.launch();
const phone = devices["Pixel 7 landscape"];
const ctx = await browser.newContext({ ...phone, userAgent: phone.userAgent + " MarioGolfWrapper" });
await ctx.exposeBinding("__saveRom", (_s, b64) => { kept = Buffer.from(b64, "base64"); });
await ctx.addInitScript(() => { window.MGolfApp = { saveRom: b => window.__saveRom(b), forgetRom() {} }; });
const errors = [];
const tap = async (page, key, ms = 200) => { const b = page.locator(`#pad button[data-key="${key}"]`); await b.dispatchEvent("pointerdown", { pointerId: 1 }); await page.waitForTimeout(ms); await b.dispatchEvent("pointerup", { pointerId: 1 }); };
const out = {};
for (const run of ["first", "second"]) {
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(run + ": " + e.message));
  await page.goto("http://localhost:8766/assets/web/index.html");
  await page.waitForTimeout(1500);
  out[run] = { pickerShown: await page.isVisible("#loader") };
  if (run === "first") {
    await page.setInputFiles("#file", path.join(root, "rom", "mario_golf.gbc"));
    await page.waitForTimeout(1000);
    out.first.romKept = kept ? kept.length : 0;
  }
  await page.waitForTimeout(11000);
  await tap(page, "Enter"); await page.waitForTimeout(3000); await tap(page, "Enter"); await page.waitForTimeout(3000); await tap(page, "KeyZ"); await page.waitForTimeout(2500);
  Object.assign(out[run], await page.evaluate(() => ({ frames: window.__mg?.gb?.frames, padVisible: getComputedStyle(document.getElementById("pad")).display,
    screen: (r => [Math.round(r.width), Math.round(r.height)])(document.getElementById("screen").getBoundingClientRect()) })));
  await page.screenshot({ path: `out/app_${run}.png` });
  await page.close();
}
console.log(JSON.stringify({ ...out, errors }));
await browser.close(); server.close();
process.exit(errors.length || !out.first.romKept || out.second.pickerShown || !out.second.frames ? 1 : 0);
