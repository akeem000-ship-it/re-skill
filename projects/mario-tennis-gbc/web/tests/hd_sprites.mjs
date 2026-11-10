// HD sprite packs (web/js/look/hdpack.js): power on, go through the menus into an exhibition match (play_match.mjs's key script), let
// it run, and screenshot the 2D view and the 3D view with SPRITES: HD at a few moments, listing the hero frames a pack redrew.
// --state FILE.json.gz starts from a core save state (states/) instead, with no menu keys (Alex is the Mario Tour hero, not in the
// exhibition roster without a save). Needs a pack in web/hdpacks/ (tools/cut_hd_sheets.py).
// usage: node web/tests/hd_sprites.mjs OUTDIR [--state FILE] [--at F,F,...] [--size WxH] [--keys CODE@FRAME,...]
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0] || "out/hdtest", at = opt("--at", "1700,1900,2100,2300").split(",").map(Number), [W, H] = opt("--size", "720x690").split("x").map(Number);
const extra = opt("--keys", "") ? opt("--keys", "").split(",").map(k => { const [c, f] = k.split("@"); return [+f, c]; }) : [];
fs.mkdirSync(out, { recursive: true });
const GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: GL }).catch(() => chromium.launch({ args: GL }));
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", e => console.log("pageerror", e.message)); page.on("console", m => { if ((m.type() === "error" || m.type() === "warning") && !m.text().includes("404")) console.log("console", m.text()); });
await page.goto(`http://localhost:8765/web/full.html?touch&cam=low&sprites=${opt("--sprites", "hd")}`);
await page.waitForFunction(() => window.__gb && window.__gb.gb && window.__gb.gb.detail, null, { timeout: 60000 });
if (opt("--sprites", "hd") === "hd") await page.waitForFunction(() => window.__gb.gb.detail.hdOn, null, { timeout: 20000 }).catch(() => console.log("SPRITES: HD did not switch on (no pack?)"));
const state = opt("--state", "") ? JSON.parse(zlib.gunzipSync(fs.readFileSync(opt("--state")))) : null;
await page.evaluate(([extra, state]) => {
  const G = window.__gb; G.pause();
  const keys = {};
  if (state) G.loadState(state);
  else {
    Object.assign(keys, { 332: "Enter", 632: "Enter", 1300: "ArrowLeft", 1360: "KeyZ" });
    for (let k = 700; k < 1300; k += 60) keys[k] = "KeyZ";
    for (let k = 1420; k < 1600; k += 60) keys[k] = "KeyZ";
  }
  for (const [f, c] of extra) keys[f] = c;
  window.__bot = { f: 0, keys, swing: !state };
}, [extra, state]);
const run = n => page.evaluate(n => {
  const G = window.__gb, B = window.__bot;
  for (let i = 0; i < n; i++) {
    for (const [kf, code] of Object.entries(B.keys)) { if (B.f === +kf) G.keys[code] = true; if (B.f === +kf + 6) G.keys[code] = false; }
    if (B.swing && B.f > 1600) G.keys.KeyZ = B.f % 50 < 3;                 // serve / swing now and then
    G.step(1); B.f++;
  }
  const d = G.gb.detail, oam = G.gb.mem.oam, tall = G.gb.ppu.lcdc & 4, sprs = [];
  for (let i = 0; i < 40; i++) { const sy = oam[i * 4] - 16, sx = oam[i * 4 + 1] - 8; if (sy <= -16 || sy >= 144 || sx <= -8 || sx >= 160) continue; sprs.push({ i, sx, sy, h: tall ? 16 : 8, tile: tall ? oam[i * 4 + 2] & 0xFE : oam[i * 4 + 2], attr: oam[i * 4 + 3] }); }
  return { f: B.f, map: G.gb.mem.wram[0][0x32E], hd: d.hdInstances(sprs).map(({ inst, e }) => `${e.n}${inst.mir ? "m" : ""}@${inst.ox},${inst.oy}`) };
}, n);
let f = 0;
for (const t of at) {
  const r = await run(t - f); f = t;
  console.log(JSON.stringify(r));
  await page.evaluate(() => { window.__gb.view3d(false); window.__gb.step(1); });
  await page.screenshot({ path: `${out}/f${t}_2d.png` });
  await page.evaluate(() => { window.__gb.view3d(true); window.__gb.step(1); });
  await page.screenshot({ path: `${out}/f${t}_3d.png` });
  await page.evaluate(() => { window.__gb.view3d(false); });
}
await browser.close();
