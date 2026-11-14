// Screenshots of the match intro (web/js/intro.js) in the page: plays a recording up to the first match that starts an intro, then runs
// the intro live and saves screenshots at the given seconds into it.
// usage: (python3 -m http.server 8765 from the project root) node web/tests/intro_view.mjs FILE.mtrec OUTDIR 3.6,9.3,11.1 [vox]
import fs from "fs"; import zlib from "zlib"; import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const raw = fs.readFileSync(process.argv[2]), rec = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString()), out = process.argv[3], shots = process.argv[4].split(",").map(Number);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } }); const logs = [];
p.on("pageerror", e => logs.push("ERR " + e.message)); p.on("console", m => { if (m.type() === "warning" || m.type() === "error") logs.push(m.text()); });
await p.goto("http://localhost:8765/web/full.html?touch&stadium=3d");
await p.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
await p.evaluate(v => { window.__vox = v; }, process.argv[5] === "vox");
await p.evaluate(async rec => {
  const { stateOf } = await import("/web/js/recorder.js");
  const G = window.__gb; G.pause(); G.loadState(rec.start); G.view3d(true, window.__vox);
  const inputs = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0));
  window.__rp = { f: 0, n: inputs.length, run(n) { for (let k = 0; k < n && this.f < this.n; k++, this.f++) { G.gb.setInput(stateOf(inputs[this.f])); G.gb.runFrame(); G.voxel.tick(); } } };
}, rec);
for (let i = 0; i < 400; i++) { const s = await p.evaluate(() => { window.__rp.run(60); window.__gb.step(0); return window.__gb.voxel.intro.start; }); if (s >= 0) break; }
await p.evaluate(() => { window.__gb.voxel.intro.t0 = performance.now() / 1000; window.__gb.pause(false); }); const t0 = Date.now();
for (const t of shots) { await p.waitForTimeout(Math.max(0, t * 1000 - (Date.now() - t0))); await p.screenshot({ path: `${out}/v${String(t).replace(".", "_")}.png` });
  console.log(t, JSON.stringify(await p.evaluate(() => { const c = document.querySelector("#matchintro .vs"), r = c.getBoundingClientRect(), R = document.getElementById("matchintro").getBoundingClientRect(); return { c: [c.width, c.height, r.x, r.y, r.width, r.height, c.style.display], root: [R.x, R.y, R.width, R.height] }; }))); }
console.log(logs.filter(l => !/404/.test(l)).slice(0, 5).join("\n")); await b.close();
