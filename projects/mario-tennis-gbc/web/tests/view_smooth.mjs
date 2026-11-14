// The 3D / VOX view at a forced 120 Hz display (virtual time: the page's requestAnimationFrame is driven by the test): the game
// must step at 60 Hz, the view must be drawn on every refresh with the world interpolated between the last two game frames
// (court: the ball; overworld: the camera), and "Smooth: off" must draw once per game frame.
// usage: (python3 -m http.server 8765 from the project root) node web/tests/view_smooth.mjs
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const readRec = f => { const raw = fs.readFileSync(f); return JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString()); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }).catch(() => chromium.launch());
async function run(recf, F, smooth, secs, camY, replay) {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  await page.addInitScript(() => { const cbs = []; window.requestAnimationFrame = cb => { cbs.push(cb); return cbs.length; }; window.__tick = t => { for (const cb of cbs.splice(0)) cb(t); }; });
  await page.goto(`http://localhost:8765/web/full.html?vox&smooth=${smooth}`);
  await page.waitForFunction(() => window.__gb && window.__gb.gb && window.__gb.voxel, null, { timeout: 60000, polling: 200 });
  await page.waitForTimeout(1000);
  const out = await page.evaluate(async ([rec, F, secs, camY, replay]) => {
    const { stateOf } = await import("/web/js/recorder.js"); const G = window.__gb; G.pause(true); G.loadState(rec.start);
    const inp = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0));
    for (let f = 0; f < F; f++) { G.gb.setInput(stateOf(inp[f] || 0)); G.gb.runFrame(); }
    const V = G.voxel, series = [], orig = V.render.bind(V);
    V.render = function (f, a) { const r = orig(f, a); if (V.mode === "field" && V.fi) series.push(camY ? V.fi.sy : V.fi.sx); else if (V.mode === "3d") series.push(V.interp().ball.X); return r; };
    const MAP = [["KeyZ", 1], ["KeyX", 2], ["KeyQ", 4], ["Enter", 8], ["ArrowRight", 16], ["ArrowLeft", 32], ["ArrowUp", 64], ["ArrowDown", 128]]; let fStart = null, vt = 1000;
    const run = n => { for (let k = 0; k < n; k++) { if (replay) { if (fStart === null) fStart = G.gb.ppu.frames; const m = inp[F + (G.gb.ppu.frames - fStart)] || 0; for (const [kc, b] of MAP) G.keys[kc] = !!(m & b); } vt += 1000 / 120; window.__tick(vt); } };
    G.pause(false); run(240); series.length = 0;
    const f0 = G.gb.ppu.frames, t0 = vt; run(Math.round(120 * secs));
    return { game: (G.gb.ppu.frames - f0) / ((vt - t0) / 1000), view: series.length / ((vt - t0) / 1000), series, text: document.getElementById("fps").textContent };
  }, [readRec(recf), F, secs, camY, replay]);
  await page.close(); return out;
}
const d = s => s.slice(1).map((v, i) => v - s[i]), mean = a => a.reduce((x, y) => x + y, 0) / a.length;
let bad = 0; const check = (name, ok, info) => { console.log(ok ? "ok  " : "FAIL", name, info); if (!ok) bad++; };
for (const [name, rec, F, camY, replay] of [["court rally (ball x)", "out/engine/rec2.mtrec", 9000, false, false], ["overworld walk (camera y)", "out/port/story_walk1.mtrec", 1660, true, true]]) {
  if (!fs.existsSync(rec)) { console.log("skip", rec); continue; }
  const on = await run(rec, F, 1, 1.5, camY, replay), off = await run(rec, F, 0, 1.5, camY, replay);
  const don = d(on.series), doff = d(off.series), mon = mean(don.map(Math.abs)), moff = mean(doff.map(Math.abs));
  check(name + ": game steps at 60", Math.abs(on.game - 60) < 2 && Math.abs(off.game - 60) < 2, `${on.game.toFixed(1)} / ${off.game.toFixed(1)}`);
  check(name + ": smooth draws every refresh", on.view > 118, `${on.view.toFixed(1)} fps`);
  check(name + ": smooth off draws per game frame", off.view < 62, `${off.view.toFixed(1)} fps`);
  check(name + ": motion per refresh is half the motion per game frame", Math.abs(mon * 2 - moff) < 0.25 * moff + 0.05, `${mon.toFixed(3)} x2 vs ${moff.toFixed(3)}`);
}
await browser.close(); process.exit(bad ? 1 : 0);
