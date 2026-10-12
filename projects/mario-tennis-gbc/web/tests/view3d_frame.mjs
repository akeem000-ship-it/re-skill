// Headless check of the 3D diorama view: walks the core into an exhibition match with a key script,
// turns the 3D view on and screenshots it (plus the 2D frame). usage: node web/tests/view3d_frame.mjs OUTPREFIX [--frames N]
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0] || "out/view3d", N = +opt("--frames", 2400);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 640, height: 576 } });
page.on("pageerror", e => console.log("pageerror", e.message)); page.on("console", m => { if (m.type() === "warning" || m.type() === "error") console.log("console", m.text()); });
await page.goto("http://localhost:8765/web/full.html");
await page.waitForFunction(() => window.__gb && window.__gb.gb, null, { timeout: 60000 });
const info = await page.evaluate(n => {
  const G = window.__gb; G.pause();
  const keys = { 332: "Enter", 632: "Enter", 1300: "ArrowLeft", 1360: "KeyZ" };
  for (let f = 700; f < 1300; f += 60) keys[f] = "KeyZ";
  for (let f = 1420; f < n; f += 60) keys[f] = "KeyZ";
  for (let f = 0; f < n; f++) { for (const [kf, code] of Object.entries(keys)) { if (f === +kf) G.keys[code] = true; if (f === +kf + 6) G.keys[code] = false; } G.step(1); }
  G.view3d(true); G.voxel.debug = []; G.step(1);
  const p = G.gb.ppu; return { mode: G.voxel.mode, court: G.voxel.courtId, hash: G.frameHash(), scx: p.scx, scy: p.scy, groups: G.voxel.debug };
}, N);
console.log(JSON.stringify(info));
await page.locator("#gl").screenshot({ path: `${out}_3d.png` });
await page.evaluate(() => { window.__gb.view3d(false); window.__gb.step(1); });
await page.locator("#screen").screenshot({ path: `${out}_2d.png` });
await browser.close();
