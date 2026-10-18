// Screenshots of a session recording (.mtrec / .mtrec.json) at given frames, in the 3D view, as the player saw it
// (the recording's look applied; LIGHT follows the clock of the time zone given).
// usage: (python3 -m http.server 8765 from the project root) node web/tests/rec_shots.mjs FILE OUTDIR F1,F2,.. [--tz Area/City] [--q "query"]
import fs from "fs"; import zlib from "zlib"; import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const raw = fs.readFileSync(a[0]), rec = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString());
const out = a[1], frames = a[2].split(",").map(Number).sort((x, y) => x - y); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, timezoneId: opt("--tz", "America/New_York"), userAgent: "Android MarioTennisWrapper" })).newPage();
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto(`http://localhost:8765/web/full.html?intro=off&${opt("--q", "")}`);
await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
await page.evaluate(t => { window.__two = t; }, a.includes("--2d"));
await page.evaluate(async rec => {
  const { stateOf } = await import("/web/js/recorder.js");
  const G = window.__gb; G.pause(); G.loadState(rec.start); G.view3d(!window.__two);
  const inputs = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0)), events = new Map(rec.events.map(([f, e]) => [f, e]));
  window.__rp = { f: 0, run(n) { for (let k = 0; k < n; k++, this.f++) { if (events.get(this.f) === "reset") G.gb.reset(); G.gb.setInput(stateOf(inputs[this.f])); G.gb.runFrame(); if (G.voxel && G.voxel.mode === "3d") G.voxel.tick(); } } };
}, rec);
for (const f of frames) {
  // the last few frames before each shot are rendered, so interpolation and fades have history
  const cur = await page.evaluate(() => window.__rp.f);
  if (f - 8 > cur) for (let g = cur; g < f - 8; g += 2000) await page.evaluate(n => window.__rp.run(n), Math.min(2000, f - 8 - g));
  for (let k = 0; k < 8; k++) await page.evaluate(() => { window.__rp.run(1); window.__gb.voxel.debug = []; window.__gb.step(0); });
  const info = await page.evaluate(dbg => { const v = window.__gb.voxel, w = window.__gb.gb.mem.wram[0], p = window.__gb.gb.ppu; if (!v || !window.__gb.voxel.mode || window.__two) return { map: w[0x32E], oam: Array.from(window.__gb.gb.mem.oam.subarray(0, 64)).join(",") };
    return { map: w[0x32E], mode: v.mode, ...(dbg ? { scx: p.scx, scy: p.scy, hud: (v.debug.find(d => d.hud) || {}).hud, hdspr: window.__gb.hd && window.__gb.hd.has.spr, aoam: window.__gb.hd && [...(window.__gb.hd.actorOam || [])].join(","), hid: window.__gb.hd && [...window.__gb.hd.hiddenOam].join(","), act: (v.debug.find(d => d.actors) || {}).actors, loose: (v.debug.find(d => d.actors) || {}).loose, ov: JSON.stringify((v.debug.find(d => d.overlays) || {}).overlays), sc: Array.from(w.subarray(0x8E0, 0x8F0)).join(","), spr0: v.collectSprites().map(s => [s.sx, s.sy, s.tile, s.attr.toString(16), s.oam ?? ""].join(",")).join(" "), bgt: v.mode !== "3d" ? "" : (() => { const m = window.__gb.gb.mem, base = v.bgBase(), pr = v.courtMaps[v.courtId], o = []; for (let i = 0; i < 1024; i++) if (m.vram[0][base + i] !== pr[i]) o.push((i & 31) + "/" + (i >> 5)); return o.join(" "); })() } : {}) }; }, a.includes("--dbg"));
  const m = Math.floor(f / 3600), s = ((f / 60) % 60).toFixed(1);
  await page.screenshot({ path: `${out}/f${f}_${m}m${s}s.png` }); console.log(f, `${m}:${s}`, JSON.stringify(info));
}
await browser.close();
