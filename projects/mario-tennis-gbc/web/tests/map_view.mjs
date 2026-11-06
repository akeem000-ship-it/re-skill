// Any overworld map in the 3D view without a recording that goes there: a recording is replayed to a field frame, then the map is put
// into the core as LoadMap would leave it (voxel.romMapCore: tilemap, attributes, collision, tiles, palettes; the BG map written at the
// scroll; no actors) and the view rendered at each scroll. Needs a server on 8765 (python3 -m http.server 8765 from the project root).
// usage: node web/tests/map_view.mjs REC.json FRAME MAP OUTDIR X,Y[;X,Y...] [--q "query"] [--cam PITCH,DIST] [--shift TX,TY] [--size TW,TH]
// (--shift: the map's tiles from TX,TY tiles across/down copied to the top left, as the game does for a map's second room)
import fs from "fs";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const [file, f0, id, out, scrolls] = a, rec = JSON.parse(fs.readFileSync(file));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, userAgent: "Android MarioTennisWrapper" })).newPage();
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto(`http://localhost:8765/web/full.html?intro=off&${opt("--q", "")}`);
await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
await page.evaluate(async ([rec, f0]) => {
  const { stateOf } = await import("/web/js/recorder.js");
  const G = window.__gb; G.pause(); G.loadState(rec.start); G.view3d(true);
  const inputs = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0));
  for (let f = 0; f < f0; f++) { G.gb.setInput(stateOf(inputs[f])); G.gb.runFrame(); }
}, [rec, +f0]);
for (const sxy of scrolls.split(";")) {
  const [sx, sy] = sxy.split(",").map(Number);
  const info = await page.evaluate(([id, sx, sy, cam, shift, size]) => {
    const G = window.__gb, v = G.voxel, core = v.romMapCore(id), m = G.gb.mem, p = G.gb.ppu;
    if (!core) return "no map";
    const w0 = m.wram[0]; w0[0x32B] = size ? size[0] : core.mem.wram[0][0x32B]; w0[0x32C] = size ? size[1] : core.mem.wram[0][0x32C]; w0[0x32E] = id;   // (size: tiles, a room the camera bounds are moved to)
    w0[0x321] = sx >> 3; w0[0x320] = (sx & 7) << 5; w0[0x323] = sy >> 3; w0[0x322] = (sy & 7) << 5;
    for (const k of [2, 3, 6]) m.wram[k].set(core.mem.wram[k]);
    if (shift) for (let y = 0; y + shift[1] < 64; y++) for (let x = 0; x + shift[0] < 64; x++) { const s0 = (y + shift[1]) * 64 + x + shift[0]; m.wram[3][y * 64 + x] = m.wram[3][s0]; m.wram[2][y * 64 + x] = m.wram[2][s0]; }
    if (shift) for (let y = 0; y + shift[1] / 2 < 32; y++) for (let x = 0; x + shift[0] / 2 < 32; x++) m.wram[6][y * 32 + x] = m.wram[6][(y + shift[1] / 2) * 32 + x + shift[0] / 2];
    for (const k of [0, 1]) m.vram[k].set(core.mem.vram[k].subarray(0x800, 0x1800), 0x800);
    p.bgPal.set(core.ppu.bgPal); p.lcdc = (p.lcdc | 0x81) & ~0x10; p.scx = sx & 255; p.scy = sy & 255;
    const base = p.lcdc & 0x08 ? 0x1C00 : 0x1800;
    for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) {
      const X = (sx >> 3) + tx, Y = (sy >> 3) + ty, i = (Y & 63) * 64 + (X & 63), o = base + (((sy >> 3) + ty) & 31) * 32 + (((sx >> 3) + tx) & 31);
      m.vram[0][o] = m.wram[3][i]; m.vram[1][o] = m.wram[2][i];
    }
    m.wram[4].fill(0); m.oam.fill(0);
    if (cam) { v.freeCam = true; v.cam.yaw = 0; v.cam.pitch = cam[0]; v.cam.dist = cam[1]; }
    v.fieldAt = 0; v.field.needBuild = true;
    for (let k = 0; k < 3; k++) G.step(0);
    return `map ${v.mapId()} mode ${v.mode} built ${v.field.mapId}`;
  }, [+id, sx, sy, opt("--cam", "") ? opt("--cam").split(",").map(Number) : null, opt("--shift", "") ? opt("--shift").split(",").map(Number) : null, opt("--size", "") ? opt("--size").split(",").map(Number) : null]);
  await page.screenshot({ path: `${out}/m${id}_${sx}_${sy}.png` }); console.log(sxy, info);
}
await browser.close();
