// Play a session recording (.mtrec) in the page with the 3D view on and flag frames where the court renderer's
// sprite classification looks wrong: ball tiles left as HUD, a player on court drawn with no sprites, HUD sprites in the middle
// of the screen that are not a caption. Screenshots of the first flagged frames of each kind.
// usage: node web/tests/replay_view.mjs FILE.mtrec OUTDIR [--from F] [--to F] [--every N] [--shots K] [--vox] [--snap F,F,..] [--log N]
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const raw = fs.readFileSync(a[0]), rec = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString());
const out = a[1]; fs.mkdirSync(out, { recursive: true });
const from = +opt("--from", 0), to = Math.min(+opt("--to", rec.frames), rec.frames), every = +opt("--every", 4), maxShots = +opt("--shots", 6);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto("http://localhost:8765/web/full.html?touch&cam=low");
await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
await page.evaluate(async ([rec, vox]) => {
  const { stateOf } = await import("/web/js/recorder.js");
  const G = window.__gb; G.pause(); G.view3d(false); G.loadState(rec.start);
  const inputs = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0)), events = new Map(rec.events.map(([f, e]) => [f, e]));
  window.__rp = { f: 0, run(n) { for (let k = 0; k < n; k++, this.f++) { if (events.get(this.f) === "reset") G.gb.reset(); G.gb.setInput(stateOf(inputs[this.f])); G.gb.runFrame(); if (G.voxel && G.voxel.mode === "3d") G.voxel.tick(); } } };
  window.__vox = vox;
}, [rec, a.includes("--vox")]);
// fast-forward to --from without rendering
for (let f = 0; f < from; f += 3000) await page.evaluate(n => window.__rp.run(n), Math.min(3000, from - f));
await page.evaluate(() => window.__gb.view3d(true, window.__vox));
const counts = {}, shots = {}, firsts = {};
const shot = async path => { try { await page.screenshot({ path, timeout: 10000 }); } catch (e) { console.log("screenshot failed", path); } };
const flag = async (kind, f) => {
  counts[kind] = (counts[kind] || 0) + 1; (firsts[kind] ||= []).length < 20 && firsts[kind].push(f);
  if ((shots[kind] || 0) < maxShots) { shots[kind] = (shots[kind] || 0) + 1; await shot(`${out}/${kind}_${f}.png`); }
};
let court = 0; const tileHist = {}, missWhere = {}; const snaps = new Set(opt("--snap", "").split(",").filter(Boolean).map(Number));
for (let f = from; f < to; f += every) {
  const info = await page.evaluate(n => {
    const G = window.__gb; window.__rp.run(n); G.voxel.debug = []; G.step(0);
    const d = G.voxel.debug, w = G.gb.mem.wram[0];
    return { fx: [w[0x4A8], w[0x4A9], w[0x4AA]], eff: d.filter(x => "effect" in x), mode: G.voxel.mode, map: w[0x32E], drawn: d.filter(x => "X" in x).length, live: G.voxel.players().length, feet: G.voxel.players().map(p => [p.X, p.Y, p.Z, ...G.voxel.screenOf(p.X, p.Y, p.Z).map(Math.round)]), cls: d.find(x => "hud" in x) };
  }, every);
  if (snaps.has(f + every)) { await shot(`${out}/snap_${f + every}.png`); console.log(f + every, JSON.stringify(info).slice(0, 400)); }
  if (info.mode !== "3d" || !info.cls) continue;
  court++;
  const hud = info.cls.hud.map(s => s.split(",").map(Number));
  if (hud.some(([x, y, t]) => t >= 0x40 && t < 0x50 && x >= 12 && x < 140 && y >= 2 && y < 126)) await flag("ballAsHud", f + every);
  if (info.drawn < info.live) await flag("missingPlayer", f + every);
  const mid = hud.filter(([x, y, t]) => x >= 40 && x < 120 && y >= 32 && y < 104 && !(t >= 0x20 && t < 0x40));
  for (const [, , t] of mid) tileHist[t] = (tileHist[t] || 0) + 1;
  if (info.drawn < info.live) for (const [i, ft] of info.feet.entries()) { const k = ft[4] < 0 ? "above" : ft[4] > 150 ? "below" : ft[3] < -8 || ft[3] > 168 ? "side" : "onscreen"; missWhere[k] = (missWhere[k] || 0) + 1; }
  if (mid.some(([, , t]) => t < 12)) { if ((counts.midP1 || 0) < 4) console.log(f + every, JSON.stringify(info).slice(0, 900)); await flag("midP1", f + every); }
  if (mid.length) { if ((counts.midHud || 0) < +opt("--log", 3)) console.log(f + every, JSON.stringify(info)); await flag("midHud", f + every); }
}
console.log(JSON.stringify({ frames: [from, to], every, courtSamples: court, counts, firsts, midHudTiles: tileHist, missingFeet: missWhere }));
await browser.close();
