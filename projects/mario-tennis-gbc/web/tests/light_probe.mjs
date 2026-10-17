// Checks the 3D lighting layer (web/js/lighting.js, "LIGHT: Off / Day / Auto"): it is render-time only.
//  * the HUD button cycles Off -> Day -> Auto and the choice is remembered (localStorage mt-light),
//  * on an overworld map and on a court, every hour / quality tier renders without errors, changes the picture, and
//    keeps the emulation identical: the frame hash after the same frames is the same with the lighting off and on,
//  * the sky is warm and low at sunset, cool and dark at night, bright at noon.
// usage: node web/tests/light_probe.mjs [REC.mtrec]   (needs `python3 -m http.server 8765` in the project root; default recording out/engine/rec2.mtrec)
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const recf = process.argv[2] || "out/engine/rec2.mtrec";
const raw = fs.readFileSync(recf), rec = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString());
const SCENES = [["field", 3437], ["court", 24000]];                         // rec2: the academy yard (map 20), a match
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); if (m.type() === "warning" && /light/.test(m.text())) errors.push(m.text()); });
await page.goto("http://localhost:8765/web/full.html?vox&touch&font=game&ui=game");
await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
await page.waitForTimeout(1000);
let bad = 0; const fail = (...m) => { bad++; console.log("FAIL", ...m); };
// the button
const btn = await page.evaluate(() => { const b = document.getElementById("lightbtn"); if (!b) return null; const seen = [b.textContent]; for (let i = 0; i < 3; i++) { b.dispatchEvent(new Event("pointerdown")); seen.push(b.textContent); } return { seen, stored: localStorage.getItem("mt-light") }; });
if (!btn || btn.seen.join("|") !== "LIGHT: Off|LIGHT: Day|LIGHT: Auto|LIGHT: Off" || btn.stored !== "off") fail("button cycle", JSON.stringify(btn)); else console.log("button ok", btn.seen.join(" > "));
await page.evaluate(async rec => {
  const { stateOf } = await import("/web/js/recorder.js"); const G = window.__gb; G.pause(true); G.loadState(rec.start);
  const inputs = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0));
  window.__rp = { f: 0, run(n) { for (let k = 0; k < n; k++, this.f++) { G.gb.setInput(stateOf(inputs[this.f] || 0)); G.gb.runFrame(); } } };
}, rec);
let at = 0;
for (const [name, frame] of SCENES) {
  while (at < frame) { const n = Math.min(2000, frame - at); await page.evaluate(n => window.__rp.run(n), n); at += n; }
  await page.evaluate(() => { window.__snap = window.__gb.saveState(); });     // exactly this frame; the shots below run the game on, so it is restored after them
  const grab = async (hour, tier) => page.evaluate(([hour, tier]) => {
    const G = window.__gb, L = G.voxel.light; L.hourOverride = hour; L.mode = hour === null ? "off" : "auto"; L.tier = tier; L.auto = false;
    G.step(1); G.step(1);
    const cv = document.getElementById("gl"), x = cv.toDataURL(), img = new Image(); return new Promise(res => { img.onload = () => { const c = document.createElement("canvas"); c.width = 48; c.height = 27; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 48, 27); const d = g.getImageData(0, 0, 48, 27).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; res({ r: r / n, g: gg / n, b: b / n, mode: G.voxel.mode, broken: !!L.broken, msaa: L.msaa, passes: L.stats.passes }); }; img.src = x; });
  }, [hour, tier]);
  const base = await grab(null, 2); console.log(name, "off", JSON.stringify(base));
  const lum = o => 0.299 * o.r + 0.587 * o.g + 0.114 * o.b, R = {};
  for (const h of [7.5, 12, 18.4, 22]) { R[h] = await grab(h, 2); console.log(name, h, JSON.stringify(R[h])); if (R[h].broken) fail(name, h, "broken"); if (Math.abs(lum(R[h]) - lum(base)) < 0.5 && Math.abs(R[h].b - base.b) < 0.5) fail(name, h, "picture unchanged"); }
  const warm = o => (o.r - o.b) - (base.r - base.b);                                              // colour shift against the unlit picture
  if (!(warm(R[18.4]) > 10)) fail(name, "sunset is not warmer than the unlit picture", warm(R[18.4])); if (!(warm(R[22]) < -4)) fail(name, "night is not cooler", warm(R[22])); if (!(lum(R[22]) < lum(R[12]))) fail(name, "night is not darker than noon");
  for (const t of [0, 1]) { const o = await grab(18.4, t); console.log(name, "tier", t, JSON.stringify(o)); if (o.broken) fail(name, "tier", t); }
  // the game itself is untouched: the same next 120 frames from here give the same frame hash with the lighting off and on
  const run = async on => page.evaluate(async on => { const G = window.__gb, L = G.voxel.light; G.loadState(window.__snap); L.mode = on ? "auto" : "off"; L.hourOverride = 21; for (let i = 0; i < 120; i++) G.step(1); return G.frameHash(); }, on);
  const h0 = await run(false), h1 = await run(true); if (h0 !== h1) fail(name, "frame hash differs", h0, h1); else console.log(name, "frame hash identical", h0);
  await page.evaluate(() => window.__gb.loadState(window.__snap));
}
if (errors.length) fail("errors", errors.slice(0, 5).join(" | "));
console.log(bad ? `light_probe: ${bad} FAILED` : "light_probe: ok");
await browser.close(); process.exit(bad ? 1 : 0);
