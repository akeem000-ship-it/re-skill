// Checks the 3D stadium (web/js/stadium3d.js, "STADIUM: Classic / 3D"): it is render-time only.
//  * the HUD button toggles Classic / 3D and the choice is remembered (localStorage mt-stadium),
//  * on a court the 3D stadium builds its geometry (stands, crowd, hedges, chair, scoreboard, towers) and the picture changes,
//  * the crowd cheers when the game's score bytes change (read only),
//  * it works together with the lighting (LIGHT), Sprites: Detailed and every camera preset without errors,
//  * the emulation is untouched: the frame hash after the same frames is the same with Classic and 3D.
// usage: node web/tests/stadium_probe.mjs [REC.mtrec]   (needs `python3 -m http.server 8765` in the project root; default out/engine/rec2.mtrec, frame 24000 = a match)
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const recf = process.argv[2] || "out/engine/rec2.mtrec", FRAME = 24000;
const raw = fs.readFileSync(recf), rec = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString());
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }).catch(() => chromium.launch());
let bad = 0; const fail = (...m) => { bad++; console.log("FAIL", ...m); };
async function session(query, fn) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); if (m.type() === "warning" && /stadium|light/.test(m.text())) errors.push(m.text()); });
  await page.goto("http://localhost:8765/web/full.html?vox&touch&font=game&ui=game&" + query);
  await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.evaluate(async rec => {
    const { stateOf } = await import("/web/js/recorder.js"); const G = window.__gb; G.pause(true); G.loadState(rec.start);
    const inputs = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0));
    window.__rp = { f: 0, run(n) { for (let k = 0; k < n; k++, this.f++) { G.gb.setInput(stateOf(inputs[this.f] || 0)); G.gb.runFrame(); } } };
  }, rec);
  let at = 0; while (at < FRAME) { const n = Math.min(2000, FRAME - at); await page.evaluate(n => window.__rp.run(n), n); at += n; }
  await page.evaluate(() => { window.__snap = window.__gb.saveState(); });
  await fn(page); if (errors.length) fail(query, "errors", errors.slice(0, 4).join(" | ")); await page.close();
}
const grab = (page, mode, extra = "") => page.evaluate(([mode, extra]) => {
  const G = window.__gb, v = G.voxel; v.stadium.mode = mode; if (extra) eval(extra); G.step(1); G.step(1);
  const img = new Image(); const url = document.getElementById("gl").toDataURL();
  return new Promise(res => { img.onload = () => { const c = document.createElement("canvas"); c.width = 64; c.height = 36; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 64, 36); res({ px: Array.from(g.getImageData(0, 0, 64, 36).data), mode: v.mode, court: v.courtId, st: v.stadium.stats, broken: !!v.stadium.broken }); }; img.src = url; });
}, [mode, extra]);
const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return d / (a.length / 4); };

await session("light=off", async page => {
  const btn = await page.evaluate(() => { const b = document.getElementById("stadiumbtn"); if (!b) return null; const seen = [b.textContent]; for (let i = 0; i < 2; i++) { b.dispatchEvent(new Event("pointerdown")); seen.push(b.textContent); } return { seen, stored: localStorage.getItem("mt-stadium") }; });
  if (!btn || btn.seen.join("|") !== "STADIUM: 3D|STADIUM: Classic|STADIUM: 3D" || btn.stored !== "3d") fail("button toggle", JSON.stringify(btn)); else console.log("button ok", btn.seen.join(" > "));
  const A = await grab(page, "classic"), B = await grab(page, "3d");
  console.log("court", B.court, "mode", B.mode, JSON.stringify(B.st));
  if (B.mode !== "3d" || B.court < 0) fail("not on a court", B.mode, B.court);
  if (!(B.st.boxes > 1000 && B.st.crowd > 500)) fail("no geometry", JSON.stringify(B.st)); if (B.broken) fail("stadium broke");
  const d = diff(A.px, B.px); console.log("picture difference classic vs 3d", d.toFixed(1)); if (d < 4) fail("picture unchanged", d);
  // cheering: a change of the score bytes (restored afterwards)
  const ch = await page.evaluate(() => { const G = window.__gb, v = G.voxel, w = G.gb.mem.wram[0], old = w[0x8E4]; v.stadium.cheerAt = -99; w[0x8E4] = (old + 1) & 7; v.stadium.lastFr = -1; G.step(1); const t = performance.now() / 1000 - v.stadium.cheerAt; w[0x8E4] = old; return t; });
  if (!(ch >= 0 && ch < 2)) fail("no cheer on a score change", ch); else console.log("cheer started", ch.toFixed(2), "s ago");
  // crowd size by match class and the crowd-sound events (read only)
  const cl = await page.evaluate(() => { const v = window.__gb.voxel, st = v.stadium, w = window.__gb.gb.mem.wram[0], keep = [w[0x8A6], w[0x8F6], w[0x8F7]], r = {};
    for (const [k, m, l, i] of [["junior", 1, 0, 1], ["junior2", 5, 0, 0], ["senior", 1, 0, 6], ["senior2", 4, 0, 0], ["major", 2, 0, 16], ["major2", 10, 0, 0]]) { w[0x8A6] = m; w[0x8F6] = l; w[0x8F7] = i; r[k] = st.crowdClass(); }
    [w[0x8A6], w[0x8F6], w[0x8F7]] = keep; r.sizes = { ...st.crowdSizes }; r.sound = !!st.sound && typeof st.sound.cheer === "function"; return r; });
  if (cl.junior !== "junior" || cl.junior2 !== "junior" || cl.senior !== "senior" || cl.senior2 !== "senior" || cl.major !== "major" || cl.major2 !== "major" || cl.sizes.junior > cl.sizes.senior || cl.sizes.senior > cl.sizes.major || !cl.sound) fail("crowd classes", JSON.stringify(cl)); else console.log("crowd classes ok", JSON.stringify(cl.sizes));
  for (const p of ["low", "tv", "overhead", "diorama", "original"]) { await page.evaluate(p => window.__gb.preset(p), p); const g = await grab(page, "3d"); if (g.broken) fail("preset", p); }
  await page.evaluate(() => window.__gb.preset("low"));
  await grab(page, "3d", "const L = v.light; L.mode = 'auto'; L.hourOverride = 22;");
  const bl = await page.evaluate(() => window.__gb.voxel.light.broken); if (bl) fail("LIGHT broke with the stadium"); else console.log("LIGHT + stadium ok");
  // the game is untouched
  await page.evaluate(() => { window.__gb.voxel.light.mode = "off"; });
  const run = async mode => page.evaluate(async mode => { const G = window.__gb; G.loadState(window.__snap); G.voxel.stadium.mode = mode; for (let i = 0; i < 120; i++) G.step(1); return G.frameHash(); }, mode);
  const h0 = await run("classic"), h1 = await run("3d"); if (h0 !== h1) fail("frame hash differs", h0, h1); else console.log("frame hash identical", h0);
});
await session("light=off&sprites=detail&stadium=3d", async page => { const g = await grab(page, "3d"); console.log("Sprites: Detailed + 3D stadium", g.court >= 0 ? "ok" : "not on a court"); if (g.broken || g.court < 0) fail("detailed sprites session", g.court); });
console.log(bad ? `stadium_probe: ${bad} FAILED` : "stadium_probe: ok");
await browser.close(); process.exit(bad ? 1 : 0);
