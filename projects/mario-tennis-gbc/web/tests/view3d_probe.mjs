// Probe of the 3D view across scenes: runs the key script of view3d_frame.mjs, and at the requested frames
// turns the 3D view on, logs the renderer mode / object positions and screenshots both canvases.
// usage: node web/tests/view3d_probe.mjs OUTPREFIX F1,F2,... [--hold CODE:FROM:TO ...] [--vox] [--cam PRESET] [--size WxH]
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2);
const out = a[0] || "out/probe", frames = (a[1] || "400,700").split(",").map(Number).sort((x, y) => x - y);
const holds = [], pokes = []; for (let i = 0; i < a.length; i++) { if (a[i] === "--hold") holds.push(a[i + 1]); if (a[i] === "--poke") pokes.push(a[i + 1]); }   // --poke ADDR:VAL:FRAME writes WRAM0
const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d), cam = opt("--cam", "low"), [W, H] = opt("--size", "640x576").split("x").map(Number), courtLeft = +opt("--court", 1);   // --court N: N presses of Left on the court select
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", e => console.log("pageerror", e.message)); page.on("console", m => { if (m.type() === "warning" || m.type() === "error") console.log("console", m.text()); });
await page.goto(`http://localhost:8765/web/full.html?touch&cam=${cam}&aspect=${opt("--aspect", "fill")}` + (a.includes("--vox") ? "&vox" : ""));
await page.waitForFunction(() => window.__gb && window.__gb.gb, null, { timeout: 60000 });
await page.evaluate(() => { window.__gb.pause(); window.__f = 0; });
let cur = 0;
for (const f of frames) {
  const info = await page.evaluate(([from, to, holds, vox, courtLeft, pokes]) => {
    const G = window.__gb;
    const keys = { 332: "Enter", 632: "Enter", 1360: "KeyZ" };
    for (let k = 0; k < courtLeft; k++) keys[1300 - k * 12] = "ArrowLeft";
    for (let k = 700; k < 1300; k += 60) keys[k] = "KeyZ";
    for (let k = 1420; k < 20000; k += 60) keys[k] = "KeyZ";
    const H = holds.map(h => { const [code, s, e] = h.split(":"); return { code, s: +s, e: +e }; });
    const P = pokes.map(h => { const [ad, v, fr] = h.split(":"); return { ad: parseInt(ad, 16), v: +v, fr: +fr }; });
    for (let f = from; f < to; f++) {
      for (const q of P) if (f === q.fr) G.gb.mem.wram[0][q.ad & 0xFFF] = q.v;
      for (const [kf, code] of Object.entries(keys)) { if (f === +kf) G.keys[code] = true; if (f === +kf + 6) G.keys[code] = false; }
      for (const h of H) { if (f === h.s) G.keys[h.code] = true; if (f === h.e) G.keys[h.code] = false; }
      G.view3d(false); G.step(1);
    }
    G.view3d(true, vox); G.voxel.debug = []; G.step(1);
    const p = G.gb.ppu, w = G.gb.mem.wram[0]; G.pause();
    return { frame: to, mode: G.voxel.mode, court: G.voxel.courtId, map: w[0x32E], lcdc: p.lcdc.toString(16), scx: p.scx, scy: p.scy, wx: p.wx, wy: p.wy,
             p1: [w[0x486] | (w[0x487] << 8), w[0x488] | (w[0x489] << 8)], players: G.voxel.debug, cuts: G.voxel.cuts.map(c => c.name) };
  }, [cur, f, holds, a.includes("--vox"), courtLeft, pokes]);
  cur = f;
  console.log(JSON.stringify(info));
  await page.locator("#gl").screenshot({ path: `${out}_${f}_3d.png` });
  for (const c of (opt("--cams", "") ? opt("--cams", "").split(",") : [])) for (const st of opt("--styles", "cards").split(",")) {   // extra shots per preset / sprite style
    await page.evaluate(([c, vox]) => { window.__gb.view3d(true, vox); window.__gb.preset(c); window.__gb.step(1); }, [c, st === "vox"]);
    await page.locator("#gl").screenshot({ path: `${out}_${f}_${c}_${st}.png` });
  }
  await page.evaluate(() => { window.__gb.view3d(false); window.__gb.step(1); });
  await page.locator("#screen").screenshot({ path: `${out}_${f}_2d.png` });
}
await browser.close();
