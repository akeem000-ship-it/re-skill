// The 3D overworld (web/js/g3d/field3d.js) keeps what the game shows. The story mode is played with the 3D view on (?g3d=all) in
// headless Chromium (WebGL through SwiftShader): "new" powers on with no save and makes a character (the new character's room, the
// name entry, the first day in the clubhouse, out on the Field), "continue" (when out/kid.sav, or --save F, exists) loads a saved
// character into the clubhouse and walks about (talks, doors, the courtyard, the Field). Every few hundred frames the game is paused
// and its 2D picture (the page's raster of the frame) is set against the 3D picture drawn for that frame:
//   * when the 3D picture is drawn, the game's own picture must be in it wherever the game draws something over the map: the window
//     layer, the BG cells that are not the map's (bank 05's message boxes, menus and portraits are drawn into the BG over the map),
//     the sprites that are not the people; at least 90% of those pixels the same colour (the 3D canvas sampled at each Game Boy
//     pixel's centre);
//   * the people (the actors' sprites, bank 04) stand up in 3D: the pixels the people change in the 3D picture (drawn again without
//     them), on the 3D canvas scaled to 160 x 144 and divided by the square of the 3D picture's scale (its pixels per map pixel at
//     the view's centre), must be at least 0.7 of the game's own people pixels (a person drawn lying in the floor, or only its
//     head showing, is far less);
//   * a screen the 3D overworld cannot draw (a full-screen picture or menu, the name entry, a fade) shows the 2D picture.
// It would have caught the bug where the new character's room showed an empty plane, the message boxes were missing over the 3D
// overworld and the people were squashed heads in the floor.
// usage: node web/tests/story3d.mjs [--scenario new|continue|both] [--save out/kid.sav] [--shots outdir] [--quality lite|full] [--verbose]
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const verbose = args.includes("--verbose");
const saveFile = path.join(root, opt("save", "out/kid.sav")), shotDir = opt("shots", null), quality = opt("quality", "lite");
let scenarios = opt("scenario", "both") === "both" ? ["new", "continue"] : [opt("scenario")];
if (!fs.existsSync(saveFile)) { if (scenarios.includes("continue")) console.log(`skip continue: no ${path.relative(root, saveFile)}`); scenarios = scenarios.filter(s => s !== "continue"); }
// the frames to look at (the "new" script: Start at 2600, then A every 40 frames and Start every 400 (the name entry's END); the
// "continue" script: A every 20 frames into the clubhouse, then walks; the clubhouse's door, the courtyard, the encyclopedia)
const SAMPLES = {
  new: Array.from({ length: 36 }, (_, k) => 2800 + k * 250),
  continue: Array.from({ length: 24 }, (_, k) => 300 + k * 250),
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/plain" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function run(scenario) {
  const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); if (/3D view stopped/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { localStorage.clear(); });
  if (scenario === "continue") await page.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ["mg-sram-7f2062e51b4f", fs.readFileSync(saveFile).toString("base64")]);
  await page.goto(`http://localhost:${port}/web/play.html?g3d=all&g3dq=${quality}`);
  await page.waitForFunction(() => window.__golf && window.__golf.frames > 0, null, { timeout: 60000 });
  await page.evaluate(scenario => {
    const g = window.__golf; let down = null, held = null;
    const key = (c, d) => dispatchEvent(new KeyboardEvent(d ? "keydown" : "keyup", { code: c }));
    key("Space", true);                                // (the page's fast mode, held all along)
    const plan = "U,L,U,R,R,D,D,D,D,D".split(","), dirs = { D: "ArrowDown", U: "ArrowUp", L: "ArrowLeft", R: "ArrowRight" };
    g.onFrame = () => {
      const f = g.frames; if (down) { key(down, false); down = null; }
      let k = null;
      if (scenario === "new") {
        if (f === 2600) k = "Enter"; else if (f > 2600 && f % 40 === 0) k = f % 400 === 200 ? "Enter" : "KeyZ";
        if (f > 9000 && f % 40 === 20) k = ["ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight"][(f / 600 | 0) % 4];   // (out of the clubhouse to the Field)
      }
      else if (f < 3600) { if (f % 20 === 0) k = "KeyZ"; }
      else if (f % 32 < 24) { held = dirs[plan[((f - 3600) / 400 | 0) % plan.length]]; key(held, true); }
      else { if (held) { key(held, false); held = null; } if (f % 32 === 28) k = "KeyZ"; }
      if (k) { key(k, true); down = k; }
    };
  }, scenario);
  const out = { drawn: 0, flat: 0, peopleSeen: 0, overlaySeen: 0, fails: [] };
  for (const at of SAMPLES[scenario]) {
    await page.waitForFunction(n => window.__golf.frames >= n || window.__golf.error, at, { timeout: 900000 });
    const r = await page.evaluate(async () => {
      postMessage({ golfPreview: "pause", on: true }, "*"); await new Promise(res => setTimeout(res, 50));
      const g = window.__golf, w = g.w, G = window.__g3d, sc = G.scene, frame = G.lastFrame;
      if (!sc || !frame) return { skip: true };
      const { tagsOf } = await import("/web/js/g3d/hud3d.js");
      const F = sc.layers.fx.find(f => f.key === "field3d");
      G.place();
      const grab = () => { const c = document.createElement("canvas"); c.width = 160; c.height = 144; const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(G.canvas, 0, 0, 160, 144); return x.getImageData(0, 0, 160, 144).data; };
      const drew = sc.render(g, frame);
      const res = { f: g.frames, drew, field: !!(F && F.on), map: w.wram[0][0x450] };
      if (!drew || !F || !F.on) return res;
      const shot = grab(), pic = G.canvas.toDataURL();
      // the 3D picture's scale at the view's centre (160 x 144 pixels per map pixel along the ground's x): the people's pixels are
      // weighed by its square (a closer camera shows them bigger)
      const M = sc.mvp, at = [sc.eye[0], 0, sc.eye[2] - 106], pr = p => { const v = [0, 1, 3].map(j => M[j] * p[0] + M[4 + j] * p[1] + M[8 + j] * p[2] + M[12 + j]); return [v[0] / v[2] * 80, v[1] / v[2] * 72]; };
      const p0 = pr(at), p1 = pr([at[0] + 16, 0, at[2]]), zoom = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 16;
      // the people hidden: the layer's switch, and its people() emptied (an older layer without the switch)
      const own = F.people; F.hidePeople = true; F.people = () => [];
      sc.render(g, frame); const bare = grab();
      F.hidePeople = false; F.people = own;
      // what the game draws over the map, from its memory: the window's pixels, the BG cells not the map's (WRAM3 / WRAM2 $D000,
      // the 64 x 64 map, at the scroll $C320 / $C322), the sprites that are not the people (bank 04's) and the people's pixels
      const l = w.lcd, v0 = w.vram[0], v1 = w.vram[1], base = l.lcdc & 0x08 ? 0x1C00 : 0x1800, w0 = w.wram[0];
      const ox = (w0[0x320] | w0[0x321] << 8) >> 5, oz = (w0[0x322] | w0[0x323] << 8) >> 5, T = w.wram[3], A = w.wram[2];
      const over = new Uint8Array(160 * 144), ppl = new Uint8Array(160 * 144), t = tagsOf(w), sh = l.lcdc & 0x04 ? 16 : 8;
      for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) {
        const bx = (x + l.scx) & 255, by = (y + l.scy) & 255, c = base + (by >> 3) * 32 + (bx >> 3), mx = (ox + x) >> 3, my = (oz + y) >> 3;
        const inWin = (l.lcdc & 0x20) && y >= l.wy && x >= l.wx - 7;
        if (inWin || mx > 63 || my > 63 || v0[c] !== T[my * 64 + mx] || (v1[c] & 0x6F) !== (A[my * 64 + mx] & 0x6F)) over[y * 160 + x] = 1;
      }
      for (let i = 0; i < 40; i++) {
        const sy = w.oam[i * 4] - 16, sx = w.oam[i * 4 + 1] - 8, a = w.oam[i * 4 + 3], tile = sh === 16 ? w.oam[i * 4 + 2] & 0xFE : w.oam[i * 4 + 2], bank = a & 8 ? v1 : v0;
        if (sy <= -sh || sy >= 144 || sx <= -8 || sx >= 160) continue;
        for (let r = 0; r < sh; r++) { const row = a & 0x40 ? sh - 1 - r : r, lo = bank[(tile << 4) + row * 2], hi = bank[(tile << 4) + row * 2 + 1];
          for (let p = 0; p < 8; p++) { const bit = a & 0x20 ? p : 7 - p, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), X = sx + p, Y = sy + r;
            if (!ci || X < 0 || Y < 0 || X >= 160 || Y >= 144) continue;
            if (t[i] === 0x04) ppl[Y * 160 + X] = 1; else over[Y * 160 + X] = 1; } }
      }
      let n = 0, same = 0, np = 0, changed = 0;
      for (let p = 0; p < 160 * 144; p++) {
        const q = p * 4, v = frame[p], r0 = v & 255, g0 = (v >> 8) & 255, b0 = (v >> 16) & 255;
        if (over[p] && !ppl[p]) { n++; if (Math.abs(shot[q] - r0) < 28 && Math.abs(shot[q + 1] - g0) < 28 && Math.abs(shot[q + 2] - b0) < 28) same++; }
        if (ppl[p] && !over[p]) np++;
        if (Math.abs(shot[q] - bare[q]) + Math.abs(shot[q + 1] - bare[q + 1]) + Math.abs(shot[q + 2] - bare[q + 2]) > 24) changed++;
      }
      postMessage({ golfPreview: "pause", on: false }, "*");
      return { ...res, over: n, same, people: np, changed: changed / (zoom * zoom), pic };
    });
    await page.evaluate(() => postMessage({ golfPreview: "pause", on: false }, "*"));
    if (r.skip) continue;
    if (verbose) console.log(`  ${scenario} frame ${r.f} map ${r.map}: ${r.drew && r.field ? `3D; over ${r.same}/${r.over}; people ${r.changed.toFixed(0)}/${r.people} (${(r.changed / Math.max(1, r.people)).toFixed(2)})` : "2D"}`);
    const bad = [];
    if (r.drew && r.field) {
      out.drawn++;
      if (r.over > 40) { out.overlaySeen++; if (r.same < r.over * 0.9) bad.push(`the game's picture over the map (window, message box, menu, sprites) missing: ${r.same} of ${r.over} pixels the same`); }
      if (r.people > 60) { out.peopleSeen++; if (r.changed < r.people * 0.7) bad.push(`the people barely drawn: ${r.changed.toFixed(0)} pixels (at the game's scale) for the game's ${r.people}`); }
      if (shotDir && (bad.length || at % 1000 === 0)) { fs.mkdirSync(shotDir, { recursive: true }); fs.writeFileSync(path.join(shotDir, `${scenario}_${at}.png`), Buffer.from(r.pic.split(",")[1], "base64")); }
    } else out.flat++;
    if (bad.length) out.fails.push(`frame ${r.f} (map ${r.map}): ${bad.join("; ")}`);
  }
  const res = await page.evaluate(() => ({ error: window.__golf.error, failed: window.__g3d.failed }));
  await page.close();
  return { ...out, ...res, errors };
}

let ok = true;
for (const sc of scenarios) {
  const r = await run(sc);
  const good = !r.fails.length && !r.error && !r.failed && !r.errors.length && r.drawn >= 5 && r.peopleSeen >= 3 && r.overlaySeen >= 1;
  ok = ok && good;
  console.log(`${good ? "ok  " : "FAIL"} ${sc}: the 3D overworld drew ${r.drawn} of the sampled frames (the 2D picture ${r.flat}); people checked on ${r.peopleSeen}, ` +
    `the game's picture over the map on ${r.overlaySeen}${r.error ? "; game error " + r.error : ""}${r.failed ? "; 3D failed: " + r.failed : ""}` +
    `${r.errors.length ? "; page errors: " + r.errors.slice(0, 3).join(" | ") : ""}`);
  for (const f of r.fails.slice(0, 12)) console.log("     " + f);
}
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
