// Walk across a map seam from a recording: replay to frame F, then hold a direction and screenshot every N frames with the
// SEAM state (voxel.js: the crossing between neighbouring maps). Needs a server on 8765 (python3 -m http.server 8765 from the project root).
// usage: node web/tests/seam_walk.mjs REC.json OUTDIR FRAME KEY FRAMES EVERY      (KEY: up/down/left/right)
import fs from "fs";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [file, out, f0, key, nf, every] = process.argv.slice(2), rec = JSON.parse(fs.readFileSync(file));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, userAgent: "Android MarioTennisWrapper" })).newPage();
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto("http://localhost:8765/web/full.html?intro=off");
await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
await page.evaluate(async ([rec, f0]) => {
  const { stateOf } = await import("/web/js/recorder.js");
  const G = window.__gb; G.pause(); G.loadState(rec.start); G.view3d(true);
  const inputs = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0));
  for (let f = 0; f < f0; f++) { G.gb.setInput(stateOf(inputs[f])); G.gb.runFrame(); if (f > f0 - 8) G.step(0); }
}, [rec, +f0]);
for (let i = 0; i <= +nf; i++) {
  const st = await page.evaluate(k => { const G = window.__gb, v = G.voxel; G.gb.setInput({ [k]: true }); G.gb.runFrame(); G.step(0); const S = v.seam, a = v.fieldActors()[0];
    return `map${v.mapId()} ${S ? S.phase : "-"} keep${!!v.seamKeep} ${a ? a.x + "," + a.y : ""}`; }, key);
  if (i % +every === 0) { await page.screenshot({ path: `${out}/s${String(i).padStart(3, "0")}.png` }); console.log(i, st); }
}
await browser.close();
